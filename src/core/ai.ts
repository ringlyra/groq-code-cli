#!/usr/bin/env node
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { Agent } from './agent.js';
import { ConfigManager } from '../utils/local-settings.js';

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

interface MenuOption {
  id: string;
  title: string;
  description: string;
  color: string;
}

const MENU_OPTIONS: MenuOption[] = [
  { id: 'login', title: 'ログイン設定', description: 'Groq APIキーを設定', color: tn.blue },
  { id: 'model', title: 'モデル選択', description: '使用するAIモデルを変更', color: tn.magenta },
  { id: 'clear', title: '履歴クリア', description: '会話履歴をクリア', color: tn.yellow },
  { id: 'reasoning', title: 'リーズニング表示', description: 'AI推論過程の表示を切替', color: tn.cyan },
  { id: 'stats', title: 'セッション統計', description: 'トークン使用量と統計を表示', color: tn.green },
  { id: 'help', title: 'ヘルプ', description: '利用可能なコマンドを表示', color: tn.gray },
  { id: 'exit', title: '終了', description: '設定画面を終了', color: tn.red }
];

class SettingsManager {
  private configManager: ConfigManager;
  private showReasoning: boolean = false;
  private agent: Agent | null = null;
  
  constructor() {
    this.configManager = new ConfigManager();
  }

  async showMainMenu(): Promise<void> {
    while (true) {
      const selected = await this.showFzfMenu(
        'Groq Code CLI 設定',
        '設定項目を選択してください',
        MENU_OPTIONS
      );
      
      if (!selected) {
        break;
      }
      
      const shouldExit = await this.handleMenuOption(selected);
      if (shouldExit) {
        break;
      }
    }
  }

  private async showFzfMenu(
    title: string,
    subtitle: string,
    options: MenuOption[]
  ): Promise<string | null> {
    const header = [
      chalk.hex(tn.blue).bold(title),
      chalk.hex(tn.gray)(subtitle),
      ''
    ].join('\n');
    
    const fzf = spawn(
      'fzf',
      [
        '--ansi',
        '--color', [
          `fg:${tn.fg}`,
          `bg:${tn.bg}`,
          `hl:${tn.cyan}`,
          `fg+:${tn.blue}`,
          `bg+:${tn.bgPlus}`,
          `hl+:${tn.blue}`,
          `info:${tn.magenta}`,
          `prompt:${tn.blue}`,
          `pointer:${tn.blue}`,
          `marker:${tn.green}`,
          `spinner:${tn.yellow}`,
          `header:${tn.gray}`,
          `border:${tn.border}`
        ].join(','),
        '--prompt', '> ',
        '--info=hidden',
        '--header', header,
        '--bind', 'esc:abort,ctrl-c:abort'
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] }
    );
    
    fzf.on('error', (err) => {
      console.error(chalk.red('fzfが見つかりません。インストール済みか確認してください。'));
      console.error(String(err));
      process.exit(1);
    });
    
    // メニューオプションを表示
    for (const option of options) {
      const line = `${chalk.hex(option.color).bold(option.title)} - ${chalk.hex(tn.gray)(option.description)}`;
      fzf.stdin.write(line + '\n');
    }
    fzf.stdin.end();
    
    const outChunks: Buffer[] = [];
    fzf.stdout.on('data', (c) => outChunks.push(Buffer.from(c)));
    
    const fzfExit: number = await new Promise(resolve => {
      fzf.on('close', (code) => resolve(code ?? 0));
    });
    
    if (fzfExit !== 0) {
      return null;
    }
    
    const out = Buffer.concat(outChunks).toString('utf8').trim();
    if (!out) {
      return null;
    }
    
    // 選択された項目のIDを特定
    for (const option of options) {
      if (out.includes(option.title)) {
        return option.id;
      }
    }
    
    return null;
  }

  private async handleMenuOption(optionId: string): Promise<boolean> {
    switch (optionId) {
      case 'login':
        await this.handleLogin();
        break;
      case 'model':
        await this.handleModelSelection();
        break;
      case 'clear':
        await this.handleClearHistory();
        break;
      case 'reasoning':
        await this.handleReasoningToggle();
        break;
      case 'stats':
        await this.handleStats();
        break;
      case 'help':
        await this.handleHelp();
        break;
      case 'exit':
        console.log(chalk.hex(tn.green)('設定を終了します。'));
        return true;
      default:
        console.log(chalk.hex(tn.red)('不明な選択です。'));
    }
    
    // 操作後にEnterキーで続行
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => {
      rl.question(chalk.hex(tn.gray)('\nEnterキーを押して続行...'), () => {
        rl.close();
        resolve();
      });
    });
    
    return false;
  }

  private async handleLogin(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const currentApiKey = this.configManager.getApiKey();
    if (currentApiKey) {
      console.log(chalk.hex(tn.yellow)('現在APIキーが設定されています。'));
      const masked = currentApiKey.substring(0, 8) + '...';
      console.log(chalk.hex(tn.gray)(`現在のキー: ${masked}`));
    }
    
    const apiKey = await new Promise<string>(resolve => {
      rl.question(chalk.hex(tn.blue)('GROQ_API_KEY を入力 (空白でキャンセル): '), resolve);
    });
    
    rl.close();
    
    if (apiKey.trim()) {
      try {
        this.configManager.setApiKey(apiKey.trim());
        console.log(chalk.hex(tn.green)('APIキーを保存しました。'));
      } catch (error) {
        console.log(chalk.hex(tn.red)(`APIキーの保存に失敗しました: ${error}`));
      }
    } else {
      console.log(chalk.hex(tn.yellow)('キャンセルしました。'));
    }
  }

  private async handleModelSelection(): Promise<void> {
    const availableModels = [
      'moonshotai/kimi-k2-instruct',
      'groq/llama-3.1-70b-versatile',
      'groq/llama-3.1-8b-instant',
      'groq/llama-3.2-11b-text-preview',
      'groq/llama-3.2-3b-preview',
      'groq/llama-3.2-1b-preview'
    ];
    
    const currentModel = this.configManager.getDefaultModel() || 'moonshotai/kimi-k2-instruct';
    
    const modelOptions: MenuOption[] = availableModels.map(model => ({
      id: model,
      title: model,
      description: model === currentModel ? '(現在選択中)' : '',
      color: model === currentModel ? tn.green : tn.blue
    }));
    
    const selected = await this.showFzfMenu(
      'モデル選択',
      '使用するAIモデルを選択してください',
      modelOptions
    );
    
    if (selected && selected !== currentModel) {
      try {
        this.configManager.setDefaultModel(selected);
        console.log(chalk.hex(tn.green)(`モデルを変更しました: ${selected}`));
      } catch (error) {
        console.log(chalk.hex(tn.red)(`モデルの変更に失敗しました: ${error}`));
      }
    } else if (selected === currentModel) {
      console.log(chalk.hex(tn.yellow)('同じモデルが選択されています。'));
    } else {
      console.log(chalk.hex(tn.yellow)('キャンセルしました。'));
    }
  }

  private async handleClearHistory(): Promise<void> {
    const options: MenuOption[] = [
      { id: 'yes', title: 'はい', description: '履歴をクリアします', color: tn.red },
      { id: 'no', title: 'いいえ', description: 'キャンセルします', color: tn.gray }
    ];
    
    const selected = await this.showFzfMenu(
      '履歴クリア',
      '会話履歴をクリアしますか？',
      options
    );
    
    if (selected === 'yes') {
      try {
        if (!this.agent) {
          this.agent = await Agent.create('moonshotai/kimi-k2-instruct', 1.0, null, false);
        }
        this.agent.clearHistory();
        console.log(chalk.hex(tn.green)('履歴をクリアしました。'));
      } catch (error) {
        console.log(chalk.hex(tn.red)(`履歴のクリアに失敗しました: ${error}`));
      }
    } else {
      console.log(chalk.hex(tn.yellow)('キャンセルしました。'));
    }
  }

  private async handleReasoningToggle(): Promise<void> {
    this.showReasoning = !this.showReasoning;
    const status = this.showReasoning ? 'ON' : 'OFF';
    const color = this.showReasoning ? tn.green : tn.red;
    console.log(chalk.hex(color)(`リーズニング表示: ${status}`));
  }

  private async handleStats(): Promise<void> {
    console.log(chalk.hex(tn.blue).bold('セッション統計'));
    console.log(chalk.hex(tn.gray)('現在の設定:'));
    
    const apiKey = this.configManager.getApiKey();
    const model = this.configManager.getDefaultModel();
    const proxy = this.configManager.getProxy();
    
    console.log(chalk.hex(tn.cyan)(`APIキー: ${apiKey ? '設定済み' : '未設定'}`));
    console.log(chalk.hex(tn.cyan)(`モデル: ${model || 'デフォルト'}`));
    console.log(chalk.hex(tn.cyan)(`プロキシ: ${proxy || '未設定'}`));
    console.log(chalk.hex(tn.cyan)(`リーズニング表示: ${this.showReasoning ? 'ON' : 'OFF'}`));
  }

  private async handleHelp(): Promise<void> {
    console.log(chalk.hex(tn.blue).bold('Groq Code CLI ヘルプ'));
    console.log('');
    console.log(chalk.hex(tn.cyan)('利用可能な設定項目:'));
    
    for (const option of MENU_OPTIONS.filter(o => o.id !== 'exit')) {
      console.log(chalk.hex(option.color)(`  ${option.title}: ${option.description}`));
    }
    
    console.log('');
    console.log(chalk.hex(tn.gray)('キーバインド:'));
    console.log(chalk.hex(tn.gray)('  ↑/↓: 項目選択'));
    console.log(chalk.hex(tn.gray)('  Enter: 決定'));
    console.log(chalk.hex(tn.gray)('  Esc/Ctrl+C: キャンセル'));
  }
}

// コマンド推薦機能（元の機能）
async function runCommandRecommendation(query: string): Promise<number> {
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

// メイン関数
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const query = args.join(' ').trim();
  
  if (query) {
    // 引数がある場合：従来のコマンド推薦機能
    return await runCommandRecommendation(query);
  } else {
    // 引数がない場合：設定画面を表示
    try {
      const settingsManager = new SettingsManager();
      await settingsManager.showMainMenu();
      return 0;
    } catch (error) {
      console.error(chalk.red(`エラー: ${error}`));
      return 1;
    }
  }
}

main().then(c => process.exit(c));
