#!/usr/bin/env node
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { Agent } from './agent.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const query = args.join(' ').trim();
  if (!query) {
    console.error('使い方: ai <自然言語での目的>');
    return 2;
  }

  const system = [
    'あなたは Ubuntu 22.04 bash 向けのシェルコマンド推薦器です。',
    '入力された目的を最短で達成できる1つの安全なコマンドを日本語の理由と共に提案します。',
    '危険な操作(削除/上書き/ネットワーク経由のインストール/長時間常駐)は避け、必要なら確認系フラグを付与してください。',
    '理由は簡潔にし、文末は必ず「〜のため」で終えてください。',
    '出力は厳密に次のJSONのみ: {"cmd":"<実行コマンド>", "reason":"<日本語の理由>"}。余計な文は出力しないでください。'
  ].join('\n');

  const defaultModel = 'moonshotai/kimi-k2-instruct';

  let agent: Agent;
  try {
    agent = await Agent.create(defaultModel, /*temperature*/ 0.2, system, /*debug*/ false);
  } catch (e) {
    console.error(chalk.red(`初期化エラー: ${e}`));
    return 1;
  }

  let final: string | null = null;
  agent.setToolCallbacks({
    onFinalMessage: (content: string) => { final = content; }
  });

  try {
    await agent.chat(`目的: ${query}\nJSONで1案のみ返答してください。`);
  } catch (e) {
    console.error(chalk.red(String(e)));
    return 1;
  }

  if (!final) {
    console.error(chalk.red('提案の生成に失敗しました。'));
    return 1;
  }

  // JSONパース
  let cmd = '';
  let reason = '';
  try {
    const obj = JSON.parse(final);
    cmd = String(obj.cmd || '').trim();
    reason = String(obj.reason || '').trim();
  } catch {
    console.error(chalk.red('モデル出力の形式が不正です。')); 
    console.error(final);
    return 1;
  }

  if (!cmd) {
    console.error(chalk.red('有効なコマンドが得られませんでした。'));
    return 1;
  }

  // 表示整形（見やすさ向上）
  const formattedCmd = cmd
    .replace(/\s*(\&\&|\|\||\||;)\s*/g, (m, g1) => ` ${g1} \n  `)
    .trim();
  const reasonShort = reason.trim();

  // Tokyo Night カラー定義
  const tn = {
    bg: '#1a1b26',
    bgPlus: '#24283b',
    fg: '#c0caf5',
    blue: '#7aa2f7',
    cyan: '#7dcfff',
    magenta: '#bb9af7',
    green: '#9ece6a',
    red: '#f7768e',
    yellow: '#e0af68',
    gray: '#565f89',
    border: '#414868'
  } as const;

  // 理由は全行ピンクで統一（濃く表示）
  const reasonLines = reasonShort.split(/\r?\n/);
  const reasonColored: string[] = reasonLines.map(l => chalk.hex(tn.magenta)(l));

  // fzfで確認UI: 表示順 = コマンド -> 理由 -> 質問 -> Yes/No（Tokyo Night配色）
  const header = [
    chalk.hex(tn.blue).bold('コマンド:'),
    chalk.hex(tn.magenta)(formattedCmd), // コマンドはピンク
    '',
    chalk.hex(tn.blue).bold('理由:'),
    ...reasonColored, // 理由はピンク
    '',
    chalk.hex(tn.blue).bold('コマンドを承認しますか？') // 質問は青
  ].join('\n');
  const fzf = spawn(
    'fzf',
    [
      '--ansi',
      '--color', [
        `fg:${tn.fg}`,
        `bg:${tn.bg}`,
        `hl:${tn.cyan}`,
        `fg+:${tn.blue}`,        // 選択行の文字を青
        `bg+:${tn.bgPlus}`,
        `hl+:${tn.blue}`,
        `info:${tn.magenta}`,    // 2/2 カウンタをピンク
        `prompt:${tn.blue}`,     // プロンプト(選択>)を青
        `pointer:${tn.blue}`,    // 選択ポインタも青
        `marker:${tn.green}`,
        `spinner:${tn.yellow}`,
        `header:${tn.gray}`,
        `border:${tn.border}`
      ].join(','),
      '--prompt', '',
      '--info=hidden',
      '--header', header,
      '--bind', 'left:up,right:down,enter:accept,y:accept,n:abort,esc:abort,ctrl-c:abort'
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] }
  );
  fzf.on('error', (err) => {
    console.error(chalk.red('fzfが見つかりません。インストール済みか確認してください。'));
    console.error(String(err));
    process.exit(1);
  });
  // 候補は Yes / No（縦並び）。初期選択は先頭(Yes)。Tokyo Night配色で表示。
  fzf.stdin.write(chalk.hex(tn.green)('Yes') + '\n' + chalk.hex(tn.red)('No') + '\n');
  fzf.stdin.end();

  const outChunks: Buffer[] = [];
  fzf.stdout.on('data', (c) => outChunks.push(Buffer.from(c)));

  const fzfExit: number = await new Promise(resolve => {
    fzf.on('close', (code) => resolve(code ?? 0));
  });

  if (fzfExit !== 0) {
    console.error(chalk.yellow('キャンセルしました。'));
    return 130;
  }

  const out = Buffer.concat(outChunks).toString('utf8').split('\n').filter(Boolean);
  const selectedRaw = out.shift() || '';
  const selected = selectedRaw.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, ''); // strip ANSI

  if (!selected) {
    console.error(chalk.yellow('キャンセルしました。'));
    return 130;
  }

  if (selected.toLowerCase() !== 'yes') {
    console.error(chalk.yellow('キャンセルしました。'));
    return 130;
  }

  // 実行前に表示
  console.error(chalk.cyan('実行コマンド: '), cmd);
  console.error(chalk.cyan('理由: '), reason);

  // 実行（bash -lcで展開有効）
  const sh = spawn('bash', ['-lc', cmd], { stdio: 'inherit' });
  const code: number = await new Promise(resolve => sh.on('close', c => resolve(c ?? 0)));
  return code;
}

// 対話で使うかもしれないキー入力ヘルパ（現状未使用）
async function promptOnce(rl: readline.Interface, q: string): Promise<string> {
  return await new Promise(resolve => rl.question(q, resolve));
}

main().then(c => process.exit(c));
