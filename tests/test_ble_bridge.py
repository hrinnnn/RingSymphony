import asyncio
import json
import logging
import struct
import types
import unittest
from unittest.mock import patch

from bridge.ble_bridge import (
    ACC_SCALE, BUTTONS, GYR_SCALE, IMU_START, IMU_STOP, LOCAL_ORIGIN, NORMAL_NOTIFICATIONS,
    RX, SERVICE, TX, Bridge, RingStream, connect_ring, decode_notification, run,
)

try:
    from websockets.asyncio.client import connect
    from websockets.asyncio.server import serve
    from websockets.exceptions import InvalidStatus
except ImportError:
    serve = None


def header(command, subtype, sequence, count, uptime):
    return struct.pack("<BBHBI", command, subtype, sequence, count, uptime)


RAW = header(0x21, 2, 65535, 2, 1010) + struct.pack(
    "<12h", -1, 0, 2048, 164, -164, 0, -2048, 2048, 0, 0, 1640, -1640,
)


class DecodeTests(unittest.TestCase):
    def test_commands_and_raw(self):
        self.assertEqual(NORMAL_NOTIFICATIONS.hex(), "2c0000")
        self.assertEqual(IMU_START.hex(), "2100c800c800d007100a0000")
        self.assertEqual(decode_notification(RAW), (
            "imu", 65535, 1010, [(-1, 0, 2048, 164, -164, 0), (-2048, 2048, 0, 0, 1640, -1640)],
        ))
        ring = RingStream("A", "Ringo Left")
        first, last = ring.messages(RAW)
        self.assertAlmostEqual(first["timestamp"], 1.005)
        self.assertEqual(first["timestamp"], first["local_timestamp"])
        self.assertEqual(first["acc"], [-ACC_SCALE, 0, 9.80665])
        self.assertAlmostEqual(first["gyr"][0], 164 * GYR_SCALE)
        self.assertEqual(last["sequence"], 1)
        self.assertEqual(list(ring.messages(RAW)), [])
        next_frame = next(ring.messages(header(0x21, 2, 1, 1, 1025) + bytes(12)))
        self.assertEqual(next_frame["sequence"], 4)
        reset = next(ring.messages(header(0x21, 2, 0, 1, 5) + bytes(12)))
        self.assertEqual(reset["sequence"], 0)

    def test_differential_sign_extension_and_wrap(self):
        first = (-32768, 32766, 123, -234, 1000, -1000)
        packet = header(0x21, 4, 42, 3, 5000) + struct.pack("<6h", *first) + bytes.fromhex(
            "f1 32 54 0d 00 10 21 28 00 e0 ee 7d",
        )
        self.assertEqual(decode_notification(packet), ("imu", 42, 5000, [
            first, (-32767, -32767, 119, -242, 984, -1032),
            (32767, 1, 122, -235, 999, -1001),
        ]))
        with self.assertRaises(ValueError):
            decode_notification(packet[:-1])

    def test_buttons_and_invalid_lengths(self):
        ring = RingStream("B", "Ringo Right")
        for code, (action, label) in enumerate(BUTTONS):
            packet = header(0x27, 2, 19, code, 2015)
            self.assertEqual(list(ring.messages(packet)), [{
                "type": "button", "address": "B", "name": "Ringo Right", "timestamp": 2.015,
                "seq": 19, "event": code, "action": action, "label": label,
            }])
        for packet in (RAW[:-1], b"\x21\x02", header(0x27, 2, 1, 5, 20), packet + b"\0"):
            with self.assertRaises(ValueError):
                decode_notification(packet)
        self.assertIsNone(decode_notification(b"\x27\x03"))

    def test_local_origin_matches_the_whole_header(self):
        for origin in ("http://localhost", "https://127.0.0.1:5173", "http://[::1]:8787"):
            self.assertIsNotNone(LOCAL_ORIGIN.match(origin))
        for origin in ("http://localhost.evil.com", "https://127.0.0.1.example",
                       "http://localhost:5173/path", "https://other.example"):
            self.assertIsNone(LOCAL_ORIGIN.match(origin))


@unittest.skipIf(serve is None, "websockets 14+ is required for loopback tests")
class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_scanner_retries_the_same_device_with_a_two_ring_limit(self):
        devices = [types.SimpleNamespace(address=address, name=f"Ringo {address}") for address in "ABC"]
        attempts = []
        stopped = []
        reconnected = asyncio.Event()

        class FakeScanner:
            @staticmethod
            async def discover(*, timeout, return_adv):
                self.assertEqual(timeout, 3)
                self.assertTrue(return_adv)
                return {device.address: (device, types.SimpleNamespace(local_name=device.name))
                        for device in devices}

        async def connect_device(_bridge, ring, _device):
            attempts.append(ring.address)
            if ring.address == "A":
                if attempts.count("A") == 1:
                    return  # first connection drops
                reconnected.set()
            try:
                await asyncio.Future()
            finally:
                stopped.append(ring.address)

        with patch.dict("sys.modules", {"bleak": types.SimpleNamespace(BleakScanner=FakeScanner)}), \
                patch("bridge.ble_bridge.connect_ring", connect_device):
            task = asyncio.create_task(run(0, "Ringo", []))
            try:
                await asyncio.wait_for(reconnected.wait(), 4)
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self.assertEqual(attempts, ["A", "B", "A"])
        self.assertCountEqual(stopped, ["A", "B"])

    async def test_loopback_origin_and_notifications(self):
        bridge = Bridge()
        ring = RingStream("A", "Ringo Left", connected=True)
        bridge.rings["a"] = ring
        logger = logging.getLogger("test-ble-loopback")
        logger.disabled = True
        async with serve(bridge.handle, "127.0.0.1", 0, origins=[None, LOCAL_ORIGIN], logger=logger) as server:
            port = server.sockets[0].getsockname()[1]
            url = f"ws://127.0.0.1:{port}"
            for origin in (None, f"http://localhost:{port}"):
                async with connect(url, origin=origin) as client:
                    async def read():
                        return json.loads(await asyncio.wait_for(client.recv(), 1))
                    self.assertEqual(await read(), {"type": "bridge", "tcp": True, "source": "ble"})
                    self.assertEqual(await read(), {"type": "status", "rings": [ring.status()]})
                    packet = header(0x27, 2, 1, 2, 1000)
                    bridge.publish(next(ring.messages(packet)))
                    self.assertEqual((await read())["action"], "click")
            with self.assertRaises(InvalidStatus):
                async with connect(url, origin="https://other.example"):
                    self.fail("a remote origin reached the bridge")

    async def test_gatt_setup_and_reconnect(self):
        ring = RingStream("A", "Ringo Left")
        seen = []
        device = object()
        services = types.SimpleNamespace(get_service=lambda uuid: object() if uuid == SERVICE else None)

        class FakeClient:
            def __init__(self, discovered, disconnected_callback):
                self.callback = disconnected_callback
                self.services = services
                assert discovered is device

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                seen.append("disconnect")

            async def start_notify(self, uuid, on_data):
                self.receive = on_data
                seen.append(uuid)

            async def write_gatt_char(self, uuid, value, *, response):
                seen.append((uuid, value, response))
                if value == IMU_START:
                    self.receive(None, RAW)
                    asyncio.get_running_loop().call_soon(self.callback, self)
                elif value == IMU_STOP and seen.count("disconnect") == 0:
                    raise OSError("the device has already disconnected")

        bridge = Bridge()
        bridge.rings["a"] = ring
        bridge.publish = lambda message: seen.append(message["type"])
        with patch.dict("sys.modules", {"bleak": types.SimpleNamespace(BleakClient=FakeClient)}):
            await connect_ring(bridge, ring, device)
            await connect_ring(bridge, ring, device)
        self.assertFalse(ring.connected)
        setup = [TX, (RX, NORMAL_NOTIFICATIONS, False), (RX, IMU_START, False)]
        teardown = [(RX, IMU_STOP, False), "disconnect", "status"]
        self.assertEqual(seen, setup + ["imu", "imu", "status"] + teardown + setup + ["status"] + teardown)


if __name__ == "__main__":
    unittest.main()
