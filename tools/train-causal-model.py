"""Train a small gesture classifier with the browser's feature extractor."""

import argparse
import json
import math
import random
import statistics
import subprocess
from collections import Counter, defaultdict
from pathlib import Path


def standardize(values, mean, scale):
    return [max(-12, min(12, (value - center) / unit))
            for value, center, unit in zip(values, mean, scale)]


def affine(x, layer):
    return [b + sum(w * value for w, value in zip(row, x))
            for row, b in zip(layer["weights"], layer["bias"])]


def hidden_values(x, hidden):
    return [math.tanh(value) for value in affine(x, hidden)] if hidden else x


def probabilities(x, output):
    logits = affine(x, output)
    largest = max(logits)
    exp = [math.exp(value - largest) for value in logits]
    total = sum(exp)
    return [value / total for value in exp]


def update(layer, x, errors, step):
    for i, error in enumerate(errors):
        layer["bias"][i] -= step * error
        layer["weights"][i] = [w - step * (error * value + 0.001 * w)
                               for w, value in zip(layer["weights"][i], x)]


def fit(rows, labels, epochs, width=0):
    columns = list(zip(*(row["x"] for row in rows)))
    mean = [statistics.fmean(column) for column in columns]
    scale = [max(1e-4, statistics.pstdev(column)) for column in columns]
    rng = random.Random(101)
    hidden = None
    if width:
        limit = math.sqrt(6 / (len(mean) + width))
        hidden = {"weights": [[rng.uniform(-limit, limit) for _ in mean] for _ in range(width)],
                  "bias": [0.0] * width}
    output = {"weights": [[0.0] * (width or len(mean)) for _ in labels], "bias": [0.0] * len(labels)}
    count = Counter(row["label"] for row in rows)
    class_weight = {name: min(4, math.sqrt(len(rows) / (len(labels) * size))) for name, size in count.items()}
    training = [(standardize(row["x"], mean, scale), labels.index(row["label"]), class_weight[row["label"]])
                for row in rows]
    for epoch in range(epochs):
        rng.shuffle(training)
        step = 0.015 / math.sqrt(1 + epoch / 8)
        for x, target, weight in training:
            activation = hidden_values(x, hidden)
            prediction = probabilities(activation, output)
            errors = [(predicted - (i == target)) * weight for i, predicted in enumerate(prediction)]
            if hidden:
                hidden_errors = [(1 - value ** 2) * sum(error * row[j]
                                 for error, row in zip(errors, output["weights"]))
                                 for j, value in enumerate(activation)]
                update(hidden, x, hidden_errors, step)
            update(output, activation, errors, step)
    model = {"mean": mean, "scale": scale, "output": output}
    if hidden:
        model["hidden"] = hidden
    return model


def folds(rows, requested):
    key = "player" if len({row["player"] for row in rows}) >= 3 else "group"
    groups = defaultdict(list)
    for row in rows:
        groups[row[key]].append(row)
    count = min(requested, len(groups))
    if count < 2:
        raise SystemExit("Need at least two independent recording groups for validation.")
    buckets = [[] for _ in range(count)]
    bucket_counts = [Counter() for _ in buckets]
    for group in sorted(groups.values(), key=len, reverse=True):
        mix = Counter(row["label"] for row in group)
        i = min(range(count), key=lambda index:
                (sum(bucket_counts[index][label] * n for label, n in mix.items()), len(buckets[index])))
        buckets[i].extend(group)
        bucket_counts[i].update(mix)
    return key, buckets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directories", nargs="*", type=Path, default=[Path("recordings")])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--arch", choices=["linear", "mlp", "cnn"],
                        help="network architecture (default: linear, or mlp with --hidden)")
    parser.add_argument("--hidden", type=int, default=0,
                        help="tanh hidden units (0 for linear softmax, up to 64)")
    args = parser.parse_args()
    if args.folds < 2 or args.epochs < 1:
        parser.error("require at least two folds and one epoch")
    if not 0 <= args.hidden <= 64:
        parser.error("--hidden must be between 0 and 64")
    arch = args.arch or ("mlp" if args.hidden else "linear")
    if args.hidden and arch != "mlp":
        parser.error("--hidden applies to the MLP")
    hidden = (args.hidden or 16) if arch == "mlp" else 0
    cnn = arch == "cnn"
    if cnn:
        try:
            from causal_cnn import fit_cnn, predict_cnn
        except ModuleNotFoundError as error:
            if error.name != "numpy":
                raise
            parser.error("CNN training requires NumPy (python -m pip install numpy)")
    extractor = Path(__file__).with_name("causal-samples.mjs")
    command = ["node", str(extractor), *map(str, args.directories)]
    if cnn:
        command.append("--sequence")
    result = json.loads(subprocess.check_output(command, encoding="utf-8"))
    rows = result["data"]
    if any(len(row["x"]) != result["featureCount"] for row in rows):
        parser.error("inconsistent feature dimensions from the browser extractor")
    if cnn:
        rows = [row for row in rows if row.get("sequence") is not None]
        if any(len(row["sequence"]) != result["sequenceSteps"] or any(
                len(step) != result["sequenceChannels"] for step in row["sequence"]) for row in rows):
            parser.error("inconsistent sequence dimensions from the browser extractor")
    labels = sorted({row["label"] for row in rows})
    if len(labels) < 2:
        parser.error("at least two gesture classes are needed")
    key, splits = folds(rows, args.folds)
    confusion = defaultdict(Counter)
    for i, validation in enumerate(splits):
        training = [row for j, bucket in enumerate(splits) if i != j for row in bucket]
        training_labels = sorted({row["label"] for row in training})
        if not validation or not training:
            continue
        if cnn:
            model = fit_cnn(training, training_labels, args.epochs)
            predictions = predict_cnn(model, validation)
        else:
            model = fit(training, training_labels, args.epochs, hidden)
            predictions = []
            for row in validation:
                x = standardize(row["x"], model["mean"], model["scale"])
                scores = probabilities(hidden_values(x, model.get("hidden")), model["output"])
                predictions.append(max(range(len(scores)), key=scores.__getitem__))
        for row, prediction in zip(validation, predictions):
            confusion[row["label"]][training_labels[prediction]] += 1
    recalls = [confusion[label][label] / sum(confusion[label].values()) for label in labels if confusion[label]]
    model = fit_cnn(rows, labels, args.epochs) if cnn else fit(rows, labels, args.epochs, hidden)
    model.update(arch=arch, featureVersion=result["featureVersion"], labels=labels,
                 validation={"split": key, "folds": len(splits), "samples": len(rows),
                             "hiddenUnits": hidden, "balancedAccuracy": statistics.fmean(recalls),
                             "confusion": confusion})
    if cnn:
        model["sequenceVersion"] = result["sequenceVersion"]
        model["validation"]["hiddenUnits"] = len(model["convolutions"][0]["bias"])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(model["validation"], indent=2))


if __name__ == "__main__":
    main()
