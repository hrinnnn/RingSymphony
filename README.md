# 指环指挥 · 关卡

浏览器里的关卡。音乐按固定速度走，人跟着打。按箭头方向和输入时间判定，箭头穿过金色横线时打拍。

## 打开

```bash
npm install
npm run dev
```

浏览器打开终端里的本地地址。第一次点击关卡时才会出声。

## 怎么玩

选「练习曲」。先听一小节。右手用方向键，或在画面右半边滑动，跟上飞过来的上下左右。左手点小提琴、长笛，他们才进来。E 是渐强，D 是渐弱，也可以在左半边上下滑。

- Perfect：离这一拍 80 毫秒以内
- Good：180 毫秒以内
- Miss：更远，或这一拍没有打

练习曲为 4/4、96 BPM，一小节预备、八小节计分。第 3 小节前点小提琴，第 5 小节前点长笛，第 6 小节渐强，第 7 小节渐弱。

## 这一版没有

自由模式、戒指、摄像头。打拍进入 `playBeat()`，左手通过 `playPoint()` 和 `playPalm()` 控制声部与力度。


## 舞台与检查

舞台由 Three.js 实时绘制：木纹地板、帷幕、管风琴背景、侧廊、指挥台和乐谱架。13 位坐姿乐手有面部、头发、礼服、手臂、椅子和乐器；声部启用后分别拉弓、弹键或呼吸。右手持棒，左手指人、抬掌、压掌。所有模型、木纹和谱页均由代码绘制，不使用游戏素材或背景画。

`npm test` 检查实际 Three.js 场景几何、13 位乐手的点击射线、四方向箭头与同一判定线的交点、光圈、回放清理和原始谱面时间。测试替换 GPU 渲染器，不代替真实浏览器画面与音频检查。`npm run build` 生成生产版本。

参考阅读：[The VR Critic](https://www.thevrcritic.com/reviews/maestro/)、[TheSixthAxis](https://www.thesixthaxis.com/2025/07/07/maestro-review/)、[UploadVR](https://www.uploadvr.com/maestro-vr-review/)。另检索了 [A Wolf in VR 的教学与实机视频](https://www.youtube.com/watch?v=2Ka7KFuIVwc)。呈现目标为 Double Jack 的 Maestro；Steam app 1327920 属于另一款同名作品。
