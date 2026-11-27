const ACTIONS = ["down", "up", "click", "long", "double"]
const LABELS = ["按下", "松开", "单击", "长按", "双击"]

export function validRingButton(button) {
  return button && typeof button.address === "string" && button.address.length > 0 &&
    Number.isFinite(button.timestamp) && button.timestamp >= 0 &&
    Number.isInteger(button.seq) && button.seq >= 0 && button.seq <= 65535 &&
    Number.isInteger(button.event) && button.event >= 0 && button.event < ACTIONS.length &&
    button.action === ACTIONS[button.event] && button.label === LABELS[button.event]
}
