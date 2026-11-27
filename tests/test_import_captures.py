import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "import_captures", Path(__file__).resolve().parents[1] / "tools" / "import-captures.py",
)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class ImportTests(unittest.TestCase):
    def test_group_and_game_buttons_use_their_own_device_time_origin(self):
        hands = {"left-address": "left", "right-address": "right"}
        left = {"hand": "left", "address": "left-address", "timestamp": 150.000,
                "receivedMs": 20, "seq": 433, "event": 2, "action": "click", "label": "单击"}
        right = {"hand": "right", "address": "right-address", "timestamp": 37.020,
                 "receivedMs": 29, "seq": 14, "event": 3, "action": "long", "label": "长按"}
        common = {"id": "id", "durationMs": 100, "finishReason": "complete",
                  "hands": hands, "buttons": [left, right]}
        frames = [
            {"address": address, "hand": hand, "timestamp": start + i / 200, "receivedMs": 22 + i * 5,
             "sequence": 50 + i, "acc": [0, 0, 9.81], "gyr": [0, 0, 0]}
            for address, hand, start in (("left-address", "left", 150.005), ("right-address", "right", 37.010))
            for i in range(3)
        ]
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "original"
            destination = Path(tmp) / "imported"
            group = source / "groups" / "ring-test.json"
            game = source / "games" / "test" / "game.json"
            capture.write(group, {**common, "kind": "group", "exercise": "beat-natural", "performingHand": "both",
                                  "frames": frames, "plannedCount": 1, "trials": [{"shownAtMs": 0, "endedAtMs": 100}]})
            capture.write(game, {**common, "kind": "game", "frameCount": len(frames), "gaps": [],
                                 "game": {"level": {"title": "Test"}}})
            game.with_name("imu.jsonl").write_text("".join(json.dumps(row) + "\n" for row in [
                {"type": "session", "id": "id"}, *frames, {"type": "end", "frames": len(frames)},
            ]), encoding="utf-8")
            before = {path: path.read_bytes() for path in source.rglob("*") if path.is_file()}
            capture.import_captures(source, destination)
            for file in ("groups/01-beat-natural.json", "games/01.json"):
                imported = capture.load(destination / file)
                self.assertEqual(imported["streams"]["left"]["t"], [0, 0.005, 0.01])
                self.assertEqual(imported["streams"]["right"]["t"], [0, 0.005, 0.01])
                self.assertEqual(len(imported["buttons"]), 2)
                for raw, relative, event in zip((left, right), (-0.005, 0.01), imported["buttons"]):
                    self.assertEqual(event["timestamp"], relative)
                    self.assertEqual(event["device"], imported["streams"][raw["hand"]]["device"])
                    for key in ("hand", "receivedMs", "seq", "event", "action", "label"):
                        self.assertEqual(event[key], raw[key])
                    self.assertNotIn("address", event)
            self.assertEqual({path: path.read_bytes() for path in before}, before)
            with self.assertRaises(FileExistsError):
                capture.import_captures(source, source)

    def test_button_without_imu_anchor_keeps_its_timestamp_basis(self):
        record = {"kind": "group", "durationMs": 100, "finishReason": "partial",
                  "hands": {"A": "left"}, "trials": [],
                  "buttons": [{"hand": "left", "address": "A", "timestamp": 90.0, "receivedMs": 20}]}
        result = capture.session_for(record, [], {"A": "ring-01"})
        self.assertEqual(result["buttons"][0]["timestamp"], 90)
        self.assertEqual(result["buttons"][0]["timestampBasis"], "device_uptime")
