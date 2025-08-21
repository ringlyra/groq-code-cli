# No TUI 状態へ戻す手順メモ

## 目的
この「No TUI」状態（タグ: `v1.1.0`）に安全に戻すための手順です。

## 前提
- リポジトリ: `~/projects/groq-code-cli`
- タグ: `v1.1.0`
- 予備パッチ: `~/projects/groq-code-cli-no-tui.patch`（親ディレクトリ）

## 最速で戻す（タグへ移動）
1) 現状を保存（任意）
```
cd ~/projects/groq-code-cli
git status
git add -A
git commit -m "wip: before rollback" || true
```
2) タグへチェックアウト
```
git checkout v1.1.0
```
3) ビルド/確認
```
npm run build
node dist/core/cli.js --version
```

## ブランチで保持しつつ戻す（安全）
```
git add -A && git commit -m "wip: before switch" || true
git switch -c no-tui-v1.1.0 v1.1.0
npm run build && node dist/core/cli.js --version
```

## 完全に巻き戻す（作業破棄して固定）
注意: 未コミット変更は消えます。
```
git fetch --tags
git reset --hard v1.1.0
```

## パッチで戻す（タグが使えない場合）
未コミットを破棄してから適用:
```
git restore --staged . && git checkout -- . || true
git apply ../groq-code-cli-no-tui.patch
```
競合が出る場合:
```
git apply --reject ../groq-code-cli-no-tui.patch
```

## グローバルコマンド再登録（必要時）
```
npm run build && npm link
```
権限エラー時:
```
chmod +x $(which groq)
```

## 検証
- `groq --version` でバージョン表示
- `groq` 起動時にASCIIアートが表示されないことを確認

## 困ったときの復旧
```
git reset --hard HEAD~1
git log --oneline --decorate --graph --all
git tag -n
```

