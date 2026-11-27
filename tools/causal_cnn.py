"""NumPy training for the two causal convolutions used by the game."""

import numpy as np

HIDDEN_CHANNELS = 24
STEP_SECONDS = 0.02


def augment(samples, rng):
    """Warp about the last observed time, keeping yaw signed and magnitudes physical."""
    batch, steps, _ = samples.shape
    pos = np.arange(steps)
    warp = np.clip(steps - 1 + (pos - steps + 1) / rng.uniform(0.85, 1.15, (batch, 1)), 0, steps - 1)
    before = warp.astype(int)
    after = np.minimum(before + 1, steps - 1)
    fraction = (warp - before)[..., None]
    item = np.arange(batch)[:, None]
    warped = samples[item, before] * (1 - fraction) + samples[item, after] * fraction
    missing = np.all(warped == 0, axis=2)
    signals = warped[..., :4] * rng.uniform(0.8, 1.2, (batch, 1, 2)).repeat(2, axis=2)
    signals += rng.normal(0, [0.025, 0.025, 0.012, 0.012], signals.shape)
    signals[..., 1::2] = np.maximum(0, signals[..., 1::2])
    signals[missing] = 0
    for i, sample in enumerate(signals):
        # Remove zero to two timestamps and reconstruct only from available samples.
        dropped = rng.choice(steps, rng.integers(0, 3), replace=False)
        available = pos[~missing[i] & ~np.isin(pos, dropped)]
        if len(available):
            for channel in range(4):
                sample[dropped, channel] = np.interp(dropped, available, sample[available, channel])
        else:
            sample[dropped] = 0
    rotation = signals[..., 2:]
    jerk = np.zeros((batch, steps))
    jerk[:, 1:] = np.linalg.norm(np.diff(rotation, axis=1), axis=2) / STEP_SECONDS
    valid = np.any(signals != 0, axis=2)
    jerk[:, 1:] *= valid[:, 1:] & valid[:, :-1]
    speed = np.linalg.norm(rotation, axis=2)
    return np.concatenate((signals, speed[..., None], jerk[..., None]), axis=2).astype(np.float32)


def conv(x, weights, bias, dilation):
    steps = x.shape[1]
    padded = np.pad(x, ((0, 0), (2 * dilation, 0), (0, 0)))
    window = np.concatenate([padded[:, lag:lag + steps] for lag in (2 * dilation, dilation, 0)], axis=2)
    return np.maximum(0, window @ weights.T + bias), window


def conv_grad(weights, window, delta, dilation):
    inputs = weights.shape[1] // 3
    grad_w = delta.reshape(-1, weights.shape[0]).T @ window.reshape(-1, weights.shape[1])
    grad_b = delta.sum(axis=(0, 1))
    shifted = delta @ weights
    grad_x = shifted[..., :inputs].copy()
    for tap in (1, 2):
        lag = tap * dilation
        grad_x[:, :-lag] += shifted[:, lag:, tap * inputs:(tap + 1) * inputs]
    return grad_x, grad_w, grad_b


def forward(x, params):
    w1, b1, w2, b2, output, bias = params
    hidden, window1 = conv(x, w1, b1, 1)
    final, window2 = conv(hidden, w2, b2, 2)
    pooled = np.concatenate((final.mean(axis=1), final[:, -1]), axis=1)
    logits = pooled @ output.T + bias
    exp = np.exp(logits - logits.max(axis=1, keepdims=True))
    return exp / exp.sum(axis=1, keepdims=True), (hidden, final, window1, window2, pooled)


def fit_cnn(rows, labels, epochs):
    x = np.asarray([row["sequence"] for row in rows], dtype=np.float32)
    y = np.asarray([labels.index(row["label"]) for row in rows])
    mean, scale = x.mean(axis=(0, 1)), np.maximum(x.std(axis=(0, 1)), 1e-4)
    rng = np.random.default_rng(101)
    channels = x.shape[2]
    counts = np.bincount(y, minlength=len(labels))
    class_weight = np.minimum(4, np.sqrt(len(y) / (len(labels) * counts))).astype(np.float32)

    def weight(outputs, width):
        return rng.normal(0, (2 / width) ** 0.5, (outputs, width)).astype(np.float32)

    def init(outputs, inputs):
        return weight(outputs, inputs), np.zeros(outputs, dtype=np.float32)

    width = HIDDEN_CHANNELS
    params = (*init(width, 3 * channels), *init(width, 3 * width), *init(len(labels), 2 * width))
    first_moment = [np.zeros_like(p) for p in params]
    second_moment = [np.zeros_like(p) for p in params]
    iteration = 0
    for _ in range(epochs):
        order = rng.permutation(len(y))
        for start in range(0, len(order), 48):
            batch = order[start:start + 48]
            batch_x = x[batch]
            mask = rng.random(len(batch)) < 0.65
            batch_x[mask] = augment(batch_x[mask], rng)
            inputs = np.clip((batch_x - mean) / scale, -12, 12)
            probability, (hidden, final, window1, window2, pooled) = forward(inputs, params)
            target = y[batch]
            probability[np.arange(len(batch)), target] -= 1
            delta = probability * (class_weight[target] / len(batch))[:, None]
            grad_out = delta.T @ pooled
            grad_pool = delta @ params[4]
            mean_delta, last_delta = np.split(grad_pool, 2, axis=1)
            grad_final = np.broadcast_to(mean_delta[:, None] / final.shape[1], final.shape).copy()
            grad_final[:, -1] += last_delta
            grad_hidden, grad_w2, grad_b2 = conv_grad(params[2], window2, grad_final * (final > 0), 2)
            _, grad_w1, grad_b1 = conv_grad(params[0], window1, grad_hidden * (hidden > 0), 1)
            gradients = (grad_w1, grad_b1, grad_w2, grad_b2, grad_out, delta.sum(axis=0))
            iteration += 1
            for p, g, m, v in zip(params, gradients, first_moment, second_moment):
                m[:] = 0.9 * m + 0.1 * g
                v[:] = 0.999 * v + 0.001 * g ** 2
                p -= 0.003 * (m / (1 - 0.9 ** iteration)) / (np.sqrt(v / (1 - 0.999 ** iteration)) + 1e-8)

    def layer(i):
        return {"weights": params[i].tolist(), "bias": params[i + 1].tolist()}

    model = {"mean": mean.tolist(), "scale": scale.tolist(),
             "convolutions": [layer(0), layer(2)], "output": layer(4)}
    return model


def predict_cnn(model, rows):
    x = np.asarray([row["sequence"] for row in rows], dtype=np.float32)
    x = np.clip((x - model["mean"]) / model["scale"], -12, 12)
    params = tuple(np.asarray(layer[key]) for layer in (*model["convolutions"], model["output"])
                   for key in ("weights", "bias"))
    return forward(x, params)[0].argmax(axis=1)
