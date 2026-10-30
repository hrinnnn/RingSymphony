export const SEATS = [
  { id: "violin", name: "小提琴" },
  { id: "cello", name: "大提琴" },
  { id: "piano", name: "钢琴" },
  { id: "flute", name: "长笛" },
]

const FOUR = [
  { name: "下", x: 0.5, y: 0.78 },
  { name: "左", x: 0.22, y: 0.48 },
  { name: "右", x: 0.78, y: 0.48 },
  { name: "上", x: 0.5, y: 0.22 },
]

const THREE = [
  { name: "下", x: 0.5, y: 0.78 },
  { name: "右", x: 0.78, y: 0.42 },
  { name: "左上", x: 0.28, y: 0.24 },
]

export const LEVELS = [
  { id: "four-80", meter: 4, bpm: 80, label: "四拍", points: FOUR },
  { id: "three-90", meter: 3, bpm: 90, label: "三拍", points: THREE },
  { id: "four-110", meter: 4, bpm: 110, label: "四拍", points: FOUR },
]
