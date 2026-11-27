#!/usr/bin/env python3
"""Import a local capture directory into a shareable, replayable IMU dataset."""

import argparse
import json
import math
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, data, *, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, allow_nan=False,
                      indent=2 if pretty else None, separators=None if pretty else (",", ":"))
    path.write_text(body + "\n", encoding="utf-8")


def streams_for(record, frames, aliases):
    streams = {hand: {"device": aliases[address], "t": [], "receivedMs": [], "sequence": [],
                      "acc": [], "gyr": []} for address, hand in record["hands"].items()}
    origins = {}
    for frame in frames:
        address = frame["address"]
        hand = record["hands"][address]
        assert hand == frame["hand"]
        timestamp = frame["timestamp"]
        sequence = frame["sequence"]
        t0, seq0 = origins.setdefault(address, (timestamp, sequence))
        stream = streams[hand]
        stream["t"].append(round(timestamp - t0, 6))
        stream["receivedMs"].append(frame["receivedMs"])
        stream["sequence"].append(sequence - seq0)
        for axis in ("acc", "gyr"):
            vector = frame[axis]
            assert len(vector) == 3 and all(math.isfinite(value) for value in vector)
            stream[axis].append([round(value, 6) for value in vector])

    for stream in streams.values():
        seq = stream["sequence"]
        times = stream["t"]
        arrivals = stream["receivedMs"]
        stream["samples"] = len(times)
        stream["quality"] = {
            "missingSequenceNumbers": sum(max(0, cur - prev - 1) for prev, cur in zip(seq, seq[1:])),
            "clockResets": sum(cur <= prev for prev, cur in zip(times, times[1:])),
            "maxReceiveGapMs": max((cur - prev for prev, cur in zip(arrivals, arrivals[1:])), default=0),
        }
        assert all(cur >= prev for prev, cur in zip(arrivals, arrivals[1:]))
    return streams, origins


def gameplay_for(record, origins, aliases):
    game = record["game"]
    result = {key: game[key] for key in ("level", "settings", "chart", "counts", "cues") if key in game}
    if clock := game.get("clock"):
        result["clock"] = {"receivedMs": round(clock["atMs"] - record["startAtMs"], 3),
                           "songSeconds": clock["songSeconds"]}
    result["events"] = []
    for event in game.get("events", []):
        address = event["address"]
        cleaned = {key: value for key, value in event.items() if key not in ("address", "name", "receivedAtMs", "t")}
        cleaned["device"] = aliases[address]
        if "t" in event and address in origins:
            cleaned["t"] = round(event["t"] - origins[address][0], 6)
        cleaned["receivedMs"] = round(event["receivedAtMs"] - record["startAtMs"], 3)
        result["events"].append(cleaned)
    if report := game.get("report"):
        result["report"] = {key: report[key] for key in ("version", "assumption", "summary", "strokes")}
        result["report"]["summary"]["level"].pop("startedAt", None)
    return result


def session_for(record, frames, aliases):
    streams, origins = streams_for(record, frames, aliases)
    result = {key: record[key] for key in ("kind", "durationMs", "finishReason")}
    for key in ("playerId", "wearNote", "dominantHand", "preflight", "forcedHealth", "quality"):
        if key in record:
            result[key] = record[key]
    result["streams"] = streams
    if "buttons" in record:
        result["buttons"] = [{**{key: value for key, value in button.items() if key != "address"},
                              "device": aliases[button["address"]]} for button in record["buttons"]]
    if record["kind"] == "group":
        for key in ("exercise", "performingHand", "direction", "plannedCount", "trials", "bpm"):
            if key in record:
                result[key] = record[key]
        if result["finishReason"] == "complete":
            assert len(result["trials"]) == result["plannedCount"]
        assert all(0 <= trial["shownAtMs"] <= trial["endedAtMs"] <= result["durationMs"]
                   for trial in result["trials"])
    else:
        result["gaps"] = [{**{key: value for key, value in gap.items() if key != "address"},
                           "device": aliases[gap["address"]]} for gap in record["gaps"]]
        result["game"] = gameplay_for(record, origins, aliases)
    return result


def import_captures(source, destination):
    manifest = {"schema": 1, "groups": [], "games": []}
    groups = sorted((source / "groups").glob("ring-*.json"))
    games = sorted((source / "games").glob("*/game.json"))
    if not groups and not games:
        raise ValueError("No capture files found")
    # Only the relative ordering of hardware addresses is used. The addresses never enter the output.
    addresses = sorted({address for path in groups + games for address in load(path)["hands"]})
    aliases = {address: f"ring-{i:02}" for i, address in enumerate(addresses, 1)}
    destination.mkdir(parents=True, exist_ok=False)
    for paths, kind in ((groups, "groups"), (games, "games")):
        for i, path in enumerate(paths, 1):
            record = load(path)
            if kind == "groups":
                frames = record["frames"]
                name = f"{kind}/{i:02}-{record['exercise']}.json"
            else:
                with path.with_name("imu.jsonl").open(encoding="utf-8") as source_stream:
                    lines = [json.loads(line) for line in source_stream]
                header, *frames, end = lines
                assert header["type"] == "session" and header["id"] == record["id"]
                assert end["type"] == "end" and end["frames"] == record["frameCount"] == len(frames)
                name = f"{kind}/{i:02}.json"
            session = session_for(record, frames, aliases)
            write(destination / name, session)
            item = {"file": name, "finishReason": session["finishReason"], "frames": len(frames)}
            if kind == "groups":
                item.update(exercise=session["exercise"], trials=len(session["trials"]))
            else:
                item["title"] = session["game"]["level"]["title"]
            manifest[kind].append(item)
    write(destination / "manifest.json", manifest, pretty=True)
    print(f"Imported {len(groups)} action groups and {len(games)} games")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Local capture directory containing groups/ and games/")
    parser.add_argument("destination", type=Path, help="A new directory for the import")
    args = parser.parse_args()
    import_captures(args.source, args.destination)
