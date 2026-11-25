"""Extract the five pitched staves of Paul De Bra's Gymnopédie arrangement."""
import json
from fractions import Fraction
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

PARTS = ("flute", "violin", "horn", "piano", "cello")
LENGTHS = {"quarter": 1, "half": 2, "eighth": Fraction(1, 2)}
NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def read_staff(staff, part, meter):
    notes = []
    ties = {}
    velocity = 0.58
    for bar, measure in enumerate(staff.findall("Measure")):
        for voice in measure.findall("voice"):
            beat = bar * meter
            ratio = Fraction(1)
            for event in voice:
                if event.tag == "Dynamic":
                    velocity = int(event.findtext("velocity")) / 127
                elif event.tag == "Tuplet":
                    ratio = Fraction(int(event.findtext("normalNotes")), int(event.findtext("actualNotes")))
                elif event.tag == "endTuplet":
                    ratio = Fraction(1)
                elif event.tag in {"Rest", "Chord"}:
                    unit = event.findtext("durationType")
                    dots = int(event.findtext("dots", "0"))
                    duration = meter if unit == "measure" else LENGTHS[unit] * (2 - Fraction(1, 2 ** dots)) * ratio
                    for xml_note in event.findall("Note"):
                        pitch = int(xml_note.findtext("pitch"))
                        spans = xml_note.findall('Spanner[@type="Tie"]')
                        linked = any(span.find("prev") is not None for span in spans)
                        continues = any(span.find("next") is not None for span in spans)
                        note = ties.pop(pitch) if linked else None
                        if note is None:
                            note = {"part": part, "beat": beat, "duration": duration,
                                    "note": f"{NAMES[pitch % 12]}{pitch // 12 - 1}",
                                    "pitch": pitch, "velocity": velocity}
                            notes.append(note)
                        else:
                            note["duration"] += duration
                        if continues:
                            ties[pitch] = note
                    beat += duration
            if beat != (bar + 1) * meter:
                raise ValueError(f"{part} bar {bar + 1} has {beat - bar * meter} beats")
    return notes


with ZipFile("public/scores/Gymnopedie-1.mscz") as archive:
    score = ET.fromstring(archive.read("Gymnopedie-1.mscx")).find("Score")
meter = int(score.findtext(".//TimeSig/sigN"))
bpm = 60 * float(score.findtext(".//Tempo/tempo"))
staves = score.findall("Staff")
notes = [note for staff, part in zip(staves, PARTS) for note in read_staff(staff, part, meter)]
notes.sort(key=lambda note: (note["beat"], note["part"], note["pitch"]))
next_attack = {}
for note in reversed(notes):
    key = (note["part"], note["pitch"])
    beat = note["beat"]
    later = next_attack.get(key)
    note["maxDuration"] = float(later - beat) if later is not None else None
    next_attack[key] = beat
    note["beat"] = float(beat)
    note["duration"] = float(note["duration"])
Path("src/gymnopedie-score.json").write_text(json.dumps({
    "bpm": bpm, "meter": meter, "endBeat": len(staves[0].findall("Measure")) * meter, "notes": notes,
}, separators=(",", ":")) + "\n")
