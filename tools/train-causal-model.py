"""Train a small softmax model with the browser's feature extractor."""

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


def probabilities(x, weights, intercept):
    logits = [b + sum(w * value for w, value in zip(row, x)) for row, b in zip(weights, intercept)]
    largest = max(logits)
    exp = [math.exp(value - largest) for value in logits]
    total = sum(exp)
    return [value / total for value in exp]


def fit(rows, labels, epochs):
    columns = list(zip(*(row["x"] for row in rows)))
    mean = [statistics.fmean(column) for column in columns]
    scale = [max(1e-4, statistics.pstdev(column)) for column in columns]
    weights = [[0.0] * len(mean) for _ in labels]
    intercept = [0.0] * len(labels)
    count = Counter(row["label"] for row in rows)
    class_weight = {name: min(4, math.sqrt(len(rows) / (len(labels) * size))) for name, size in count.items()}
    training = [(standardize(row["x"], mean, scale), labels.index(row["label"]), class_weight[row["label"]])
                for row in rows]
    rng = random.Random(101)
    for epoch in range(epochs):
        rng.shuffle(training)
        step = 0.015 / math.sqrt(1 + epoch / 8)
        for x, target, weight in training:
            prediction = probabilities(x, weights, intercept)
            for i, predicted in enumerate(prediction):
                error = (predicted - (i == target)) * weight
                intercept[i] -= step * error
                weights[i] = [w - step * (error * value + 0.001 * w) for w, value in zip(weights[i], x)]
    return {"mean": mean, "scale": scale, "output": {"weights": weights, "bias": intercept}}


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
    args = parser.parse_args()
    if args.folds < 2 or args.epochs < 1:
        parser.error("require at least two folds and one epoch")
    extractor = Path(__file__).with_name("causal-samples.mjs")
    result = json.loads(subprocess.check_output(
        ["node", str(extractor), *map(str, args.directories)], encoding="utf-8"))
    rows = result["data"]
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
        model = fit(training, training_labels, args.epochs)
        for row in validation:
            x = standardize(row["x"], model["mean"], model["scale"])
            scores = probabilities(x, model["output"]["weights"], model["output"]["bias"])
            prediction = training_labels[max(range(len(scores)), key=scores.__getitem__)]
            confusion[row["label"]][prediction] += 1
    recalls = [confusion[label][label] / sum(confusion[label].values()) for label in labels if confusion[label]]
    model = fit(rows, labels, args.epochs)
    model.update(featureVersion=result["featureVersion"], labels=labels,
                 validation={"split": key, "folds": len(splits), "samples": len(rows),
                             "balancedAccuracy": statistics.fmean(recalls), "confusion": confusion})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(model["validation"], indent=2))


if __name__ == "__main__":
    main()
