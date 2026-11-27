# /// script
# requires-python = ">=3.10"
# dependencies = ["bleak>=0.22,<3", "websockets>=14,<17"]
# ///
"""Connect up to two Ringo rings and publish Ring Studio-compatible JSON."""

import argparse
import asyncio
import json
import logging
import math
import re
import struct
from dataclasses import dataclass

SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
NORMAL_NOTIFICATIONS = bytes.fromhex("2c 00 00")
IMU_START = b"\x21\x00" + struct.pack("<HHHBB", 200, 200, 2000, 16, 10) + b"\x00\x00"
HEADER = struct.Struct("<BBHBI")
SIX_AXES = struct.Struct("<6h")
ACC_SCALE = 9.80665 / 2048
GYR_SCALE = math.pi / 180 / 16.4
BUTTONS = (
    ("down", "按下"), ("up", "松开"), ("click", "单击"),
    ("long", "长按"), ("double", "双击"),
)
LOCAL_ORIGIN = re.compile(r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?")
LOG = logging.getLogger("ring-ble")


def decode_notification(data):
    """Return (kind, packet sequence, uptime in ms, samples or button code)."""
    if len(data) < 2 or data[:2] not in (b"\x21\x02", b"\x21\x04", b"\x27\x02"):
        return None
    if len(data) < HEADER.size:
        raise ValueError("truncated notification header")
    cmd, sub, seq, count, uptime = HEADER.unpack_from(data)
    payload = memoryview(data)[HEADER.size:]
    if cmd == 0x27:
        if payload or count >= len(BUTTONS):
            raise ValueError("invalid button notification")
        return "button", seq, uptime, count
    if not count:
        raise ValueError("empty IMU notification")
    if sub == 2:
        if len(payload) != count * SIX_AXES.size:
            raise ValueError("invalid raw IMU length")
        return "imu", seq, uptime, list(SIX_AXES.iter_unpack(payload))
    if len(payload) < SIX_AXES.size + 3:
        raise ValueError("truncated differential IMU prefix")
    first = SIX_AXES.unpack_from(payload)
    widths = [((payload[12 + axis // 2] >> ((axis % 2) * 4)) & 15) + 1 for axis in range(6)]
    bits = payload[15:]
    if len(bits) != ((count - 1) * sum(widths) + 7) // 8:
        raise ValueError("invalid differential IMU length")
    packed = int.from_bytes(bits, "little")
    frames = [first]
    for _ in range(count - 1):
        frame = []
        for value, width in zip(frames[-1], widths):
            modulus = 1 << width
            delta = packed & (modulus - 1)
            if delta & (modulus >> 1):
                delta -= modulus
            frame.append((value + delta + 32768) % 65536 - 32768)
            packed >>= width
        frames.append(tuple(frame))
    return "imu", seq, uptime, frames


@dataclass
class RingStream:
    address: str
    name: str
    connected: bool = False
    last_packet: tuple | None = None
    frame_sequence: int = -1

    def status(self):
        return {"address": self.address, "name": self.name, "connected": self.connected}

    def messages(self, data):
        decoded = decode_notification(data)
        if decoded is None:
            return
        kind, seq, uptime, content = decoded
        identity = {"address": self.address, "name": self.name}
        if kind == "button":
            action, label = BUTTONS[content]
            yield {"type": "button", **identity, "timestamp": uptime / 1000,
                   "seq": seq, "event": content, "action": action, "label": label}
            return
        if self.last_packet == (seq, uptime):
            return
        count = len(content)
        if self.last_packet is not None:
            last_uptime = self.last_packet[1]
            if uptime < last_uptime:
                self.frame_sequence = -1
            else:
                # Packet sequence is 16-bit and counts packets. A frame sequence
                # should advance by samples, including gaps inferred from uptime.
                self.frame_sequence += max(0, (uptime - last_uptime + 2) // 5 - count)
        self.last_packet = (seq, uptime)
        for i, sample in enumerate(content):
            self.frame_sequence += 1
            t = uptime / 1000 - (count - 1 - i) / 200
            yield {"type": "imu", **identity, "timestamp": t, "local_timestamp": t,
                   "sequence": self.frame_sequence,
                   "acc": [value * ACC_SCALE for value in sample[:3]],
                   "gyr": [value * GYR_SCALE for value in sample[3:]]}


class Bridge:
    def __init__(self):
        self.rings = {}
        self.clients = set()

    def status(self):
        return {"type": "status", "rings": [ring.status() for ring in self.rings.values()]}

    async def handle(self, connection):
        await connection.send(json.dumps({"type": "bridge", "tcp": True, "source": "ble"}))
        await connection.send(json.dumps(self.status()))
        self.clients.add(connection)
        try:
            await connection.wait_closed()
        finally:
            self.clients.discard(connection)

    def publish(self, message):
        from websockets.asyncio.server import broadcast

        ready = [client for client in self.clients if client.transport.get_write_buffer_size() < 1 << 20]
        broadcast(ready, json.dumps(message, ensure_ascii=False))


async def connect_ring(bridge, ring, device):
    from bleak import BleakClient

    disconnected = asyncio.Event()

    def on_data(_sender, data):
        try:
            for message in ring.messages(data):
                bridge.publish(message)
        except ValueError as error:
            LOG.debug("%s ignored a notification: %s", ring.address, error)

    try:
        async with BleakClient(device, disconnected_callback=lambda _: disconnected.set()) as client:
            if client.services.get_service(SERVICE) is None:
                raise ValueError("Ringo NUS service unavailable")
            await client.start_notify(TX, on_data)
            await client.write_gatt_char(RX, NORMAL_NOTIFICATIONS, response=False)
            await client.write_gatt_char(RX, IMU_START, response=False)
            ring.connected = True
            bridge.publish(bridge.status())
            LOG.info("%s connected (%s)", ring.name, ring.address)
            await disconnected.wait()
    except Exception as error:
        LOG.warning("%s: %s", ring.address, error)
    finally:
        if ring.connected:
            ring.connected = False
            bridge.publish(bridge.status())
            LOG.info("%s disconnected", ring.name)


async def run(port, prefix, addresses):
    from bleak import BleakScanner
    from websockets.asyncio.server import serve

    bridge = Bridge()
    selected = {address.casefold(): address for address in addresses}
    tasks = {}
    async with serve(bridge.handle, "127.0.0.1", port, origins=[None, LOCAL_ORIGIN]):
        LOG.info("ws://127.0.0.1:%s", port)
        try:
            while True:
                tasks = {key: task for key, task in tasks.items() if not task.done()}
                if len(tasks) < (len(selected) or 2):
                    try:
                        candidates = await BleakScanner.discover(timeout=3, return_adv=True)
                    except Exception as error:
                        LOG.warning("BLE scan: %s", error)
                        candidates = {}
                    for device, adv in candidates.values():
                        key = device.address.casefold()
                        name = adv.local_name or device.name or ""
                        if key in tasks or (selected and key not in selected):
                            continue
                        if not selected and key not in bridge.rings and not name.casefold().startswith(prefix.casefold()):
                            continue
                        if key not in bridge.rings and len(bridge.rings) >= 2:
                            continue
                        ring = bridge.rings.setdefault(key, RingStream(device.address, name or "Ringo"))
                        tasks[key] = asyncio.create_task(connect_ring(bridge, ring, device))
                await asyncio.sleep(1)
        finally:
            for task in tasks.values():
                task.cancel()
            await asyncio.gather(*tasks.values(), return_exceptions=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--prefix", default="Ringo")
    parser.add_argument("--addresses", nargs="+", default=[], metavar="ADDRESS")
    args = parser.parse_args()
    addresses = [address.strip() for entry in args.addresses for address in entry.split(",") if address.strip()]
    if len(set(address.casefold() for address in addresses)) > 2:
        parser.error("--addresses accepts at most two devices")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        asyncio.run(run(args.port, args.prefix, addresses))
    except KeyboardInterrupt:
        pass
    except OSError as error:
        parser.exit(1, f"Unable to open WebSocket server: {error}\n")


if __name__ == "__main__":
    main()
