# MECHA VERSUS

ブラウザで遊べる 1on1 の 3D ロボット対戦アクション（vs CPU）です。Three.js で作っています。
ブーストを使ったダッシュ、ステップで誘導を切る駆け引き、赤ロック・緑ロック、3段格闘、ラウンド制など、アーケードのチーム対戦ロボットアクションの遊び心地を目指しました。機体・名称・モデル・効果音はすべてオリジナルです。

**Play:** https://akikmi.github.io/mecha-versus/

## 操作

| 操作 | キーボード | ゲームパッド |
| --- | --- | --- |
| 移動 | W A S D | 左スティック |
| ジャンプ / ブースト上昇 | Space（長押しで上昇） | A（長押し） |
| ブーストダッシュ（BD） | Space を2回押し、押し続ける間継続（方向で旋回） | A を2回押し |
| 慣性ジャンプ | BD 中に Space を離してもう一度押す（水平の勢いを保ったまま上昇） | A を離して押す |
| ステップ（誘導切り） | 方向キーを素早く2回 | LB + スティック |
| ビームライフル | J | X / RT |
| 格闘（3段） | K 連打 | B |
| ミサイル | L | Y |
| 特殊射撃（チャージ式） | I | RB |
| ポーズ | Esc / P | Start |
| サウンド ON/OFF | M | - |

## ルール・システム

- HP は両機 600。先に 2 ラウンド取った方の勝ち（1 ラウンド 99 秒、時間切れは残り HP で判定）。
- ロックオンは自動。距離が近いと **赤ロック**（弾が誘導する）、遠いと **緑ロック**（誘導しない）。
- **ステップ** を出すと、そのとき自機を狙っていた弾と格闘の誘導が切れる。
- ブーストゲージを使い切るとオーバーヒートし、着地硬直が長くなる。オーバーヒートしていない着地は少し地面を滑る（ズサ）。着地するとゲージが回復する。
- **キャンセルルート**: 射撃・特殊射撃 → ステップ / BD、格闘 → BD / ステップ、格闘が当たった後に L でミサイルへ派生。
- 上半身は敵の方へ ±100° までひねって撃つ（移動撃ち）。敵が背後にいると **振り向き撃ち** になり、足が止まる。特殊射撃は足を止めて撃つ。
- 格闘が当たると一瞬止まる（ヒットストップ）。
- 連続ヒットほどダメージが下がる補正と、ダウン値がある。一定量食らうとダウンし、起き上がりに短い無敵時間がある。
- 特殊射撃はゲージが溜まると撃てる高威力ビーム（命中で強制ダウン）。
- CPU の強さはタイトル画面で Easy / Normal / Hard から選べる（設定は localStorage に保存）。

## 機体

- **AV-01 KESTREL**（バランス型）: 連射の利くビームライフル、2連装ミサイル、素早い3段格闘、ハイパービーム。
- **HB-09 GRENDEL**（重火力型）: 重いヘビービーム、4連装ミサイルポッド、ビームアックス、肩のツインキャノン。

プレイヤーが選ばなかった方の機体を CPU が使います。

## 技術メモ

- ビルドなし。素の HTML と ES Modules で、`vendor/three.module.min.js`（three@0.160.0、npm の公式 tarball から integrity を確認して同梱）を importmap で読み込みます。
- 外部への通信はありません（CDN・Web フォント・解析タグ・Cookie なし）。CSP で `connect-src 'none'` にしています。
- 効果音はすべて WebAudio でその場で合成しています。
- ACES トーンマッピング、環境マップ（RoomEnvironment）、PCF ソフトシャドウ、Bloom（UnrealBloomPass）を使っています。追加の addon は three@0.160.0 の公式 tarball（sha512 を確認）の `examples/jsm/` から `vendor/addons/` にコピーし、importmap の `three/addons/` で読み込みます。
- タイトル画面の **GRAPHICS** で HIGH / LOW を切り替えられます（LOW は影と Bloom を切り、解像度を下げます。設定は localStorage に保存）。
- `?demo` を付けると CPU 同士の対戦（デモ）になります。`?debug` を付けると FPS を表示します。

ローカルで動かす場合:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/ を開く
```

## ファイル構成

```
index.html        importmap, HUD / 画面の DOM
style.css
src/main.js       起動・ゲームループ・画面遷移・ラウンド管理
src/input.js      キーボード + Gamepad API
src/mech.js       機体の移動・ブースト・状態遷移・被弾・ダウン
src/mechModels.js プリミティブで作る機体モデル
src/weapons.js    ビーム・ミサイル・特殊射撃・格闘判定・誘導
src/ai.js         CPU の状態遷移と難易度
src/arena.js      ステージ・障害物・当たり判定
src/camera.js     背後追従カメラ（ビル回避・FOV 演出）
src/render.js     レンダラー・後処理（Bloom）・影・Graphics 設定
src/hud.js        HUD
src/audio.js      WebAudio 効果音
src/fx.js         パーティクル・発光
vendor/           three.js (MIT, THREE_LICENSE) と addons/
```

## ライセンス

three.js は MIT ライセンスです（`vendor/THREE_LICENSE`）。
