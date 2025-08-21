#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'node:readline';
import { Agent } from './agent.js';

const program = new Command();

async function runOneShot(
  query: string,
  opts: { temperature: number; system: string | null; debug?: boolean; autoApprove?: boolean; showReasoning?: boolean }
): Promise<number> {
  const { temperature, system, debug, autoApprove, showReasoning } = opts;
  const defaultModel = 'moonshotai/kimi-k2-instruct';
  try {
    const agent = await Agent.create(defaultModel, temperature, system, debug);

    let final: string | null = null;
    agent.setToolCallbacks({
      onToolStart: () => {},
      onToolEnd: () => {},
      onToolApproval: async (toolName, toolArgs) => {
        if (autoApprove) return { approved: true, autoApproveSession: true };
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        console.error(chalk.yellow(`ツール実行の許可が必要: ${toolName}`));
        console.error(chalk.yellow(`引数: ${JSON.stringify(toolArgs)}`));
        const answer = await new Promise<string>(resolve => rl.question('許可しますか? [y]es/[n]o/[a]uto: ', resolve));
        rl.close();
        const ans = answer.trim().toLowerCase();
        if (ans === 'a' || ans === 'auto') return { approved: true, autoApproveSession: true };
        if (ans === 'y' || ans === 'yes') return { approved: true };
        return { approved: false };
      },
      onThinkingText: ((content: string, reasoning?: string) => {
        if (showReasoning && reasoning) {
          console.error(chalk.cyan('Reasoning:'), reasoning);
        }
      }) as any,
      onFinalMessage: ((content: string, reasoning?: string) => {
        if (showReasoning && reasoning) {
          console.error(chalk.cyan('Reasoning:'), reasoning);
        }
        final = content;
      }) as any,
    });

    await agent.chat(query);
    if (final !== null) console.log(final);
    return 0;
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 1;
  }
}

async function promptOnce(rl: readline.Interface, q: string): Promise<string> {
  return await new Promise(resolve => rl.question(q, resolve));
}

async function startChat(
  temperature: number,
  system: string | null,
  debug?: boolean,
  proxy?: string
): Promise<void> {
  const defaultModel = 'moonshotai/kimi-k2-instruct';
  let agent: Agent;
  try {
    agent = await Agent.create(defaultModel, temperature, system, debug, proxy);
  } catch (error) {
    console.log(chalk.red(`初期化エラー: ${error}`));
    process.exit(1);
    return;
  }

  let showReasoning = false;

  agent.setToolCallbacks({
    onToolStart: (name, args) => {
      console.log(chalk.gray(`[tool:start] ${name} ${JSON.stringify(args)}`));
    },
    onToolEnd: (name, result) => {
      console.log(chalk.gray(`[tool:end]   ${name} -> ${JSON.stringify(result).slice(0, 2000)}`));
    },
    onToolApproval: async (toolName, toolArgs) => {
      const rlApprove = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(chalk.yellow(`ツール実行の許可が必要: ${toolName}`));
      console.log(chalk.yellow(`引数: ${JSON.stringify(toolArgs)}`));
      const ans = (await promptOnce(rlApprove, '許可しますか? [y]es/[n]o/[a]uto: ')).trim().toLowerCase();
      rlApprove.close();
      if (ans === 'a' || ans === 'auto') return { approved: true, autoApproveSession: true };
      if (ans === 'y' || ans === 'yes') return { approved: true };
      return { approved: false };
    },
    onThinkingText: ((content: string, reasoning?: string) => {
      if (reasoning && showReasoning) {
        console.log(chalk.cyan('Reasoning:'), reasoning);
      }
      if (content && content.trim()) {
        console.log(chalk.dim(content.trim()));
      }
    }) as any,
    onFinalMessage: ((content: string, reasoning?: string) => {
      if (reasoning && showReasoning) {
        console.log(chalk.cyan('Reasoning:'), reasoning);
      }
      console.log(content);
    }) as any,
    onMaxIterations: async (maxIterations) => {
      const rlIter = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await promptOnce(rlIter, `最大反復(${maxIterations})に達しました。続行しますか? [y/N]: `)).trim().toLowerCase();
      rlIter.close();
      return ans === 'y' || ans === 'yes';
    },
    onApiUsage: (usage) => {
      console.log(chalk.gray(`tokens: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`));
    }
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, historySize: 100 });

  const printHelp = () => {
    console.log([
      'コマンド:',
      '  /help        ヘルプ表示',
      '  /login       APIキー設定',
      '  /model       モデル名を変更',
      '  /clear       履歴をクリア',
      '  /reasoning   Reasoning表示の切替',
      '  /q, exit     終了',
    ].join('\n'));
  };

  console.log(`Groq Code CLI (no TUI)  モデル: ${agent.getCurrentModel?.() ?? 'unknown'}`);
  printHelp();

  const ask = async (): Promise<void> => {
    const line = (await promptOnce(rl, '> ')).trim();
    if (!line) return ask();

    const cmd = line.toLowerCase();
    if (cmd === '/q' || cmd === ':q' || cmd === 'exit' || cmd === 'quit') {
      rl.close();
      return;
    }
    if (cmd === '/help' || cmd === ':help' || cmd === '--help' || cmd === '-h') {
      printHelp();
      return ask();
    }
    if (cmd === '/reasoning') {
      showReasoning = !showReasoning;
      console.log(`Reasoning表示: ${showReasoning ? 'ON' : 'OFF'}`);
      return ask();
    }
    if (cmd === '/clear') {
      agent.clearHistory?.();
      console.log('履歴をクリアしました。');
      return ask();
    }
    if (cmd === '/login') {
      const key = await promptOnce(rl, 'GROQ_API_KEY を入力: ');
      agent.saveApiKey?.(key.trim());
      console.log('APIキーを保存しました。');
      return ask();
    }
    if (cmd === '/model') {
      const model = await promptOnce(rl, 'モデル名を入力: ');
      agent.setModel?.(model.trim());
      console.log(`モデルを変更しました: ${agent.getCurrentModel?.() ?? 'unknown'}`);
      return ask();
    }

    try {
      await agent.chat(line);
    } catch (err) {
      console.error(chalk.red(String(err)));
    }
    return ask();
  };

  await ask();
}

program
  .name('groq')
  .description('Groq Code CLI')
  .version('1.0.2')
  .argument('[query...]', '非対話クエリ（指定時はワンショット実行）')
  .option('-t, --temperature <temperature>', 'Temperature for generation', parseFloat, 1.0)
  .option('-s, --system <message>', 'Custom system message')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .option('-p, --proxy <url>', 'Proxy URL (e.g. http://proxy:8080 or socks5://proxy:1080)')
  .option('-y, --yes', 'Auto-approve tools (non-dangerous)')
  .option('--reasoning', 'Print reasoning when available')
  .action(async (queryParts: string[] | undefined, options) => {
    const query = (queryParts ?? []).join(' ').trim();
    if (query.length > 0) {
      const code = await runOneShot(query, {
        temperature: options.temperature ?? 1.0,
        system: options.system ?? null,
        debug: !!options.debug,
        autoApprove: !!options.yes,
        showReasoning: !!options.reasoning,
      });
      process.exit(code);
      return;
    }
    await startChat(
      options.temperature,
      options.system || null,
      options.debug,
      options.proxy
    );
  });

program
  .command('exec <query>')
  .description('Run non-interactive query and print result')
  .option('-t, --temperature <temperature>', 'Temperature for generation', parseFloat, 1.0)
  .option('-s, --system <message>', 'Custom system message')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .option('-y, --yes', 'Auto-approve tools (non-dangerous)')
  .option('--reasoning', 'Print reasoning when available')
  .action(async (query: string, options: any) => {
    const code = await runOneShot(query, {
      temperature: options.temperature ?? 1.0,
      system: options.system ?? null,
      debug: !!options.debug,
      autoApprove: !!options.yes,
      showReasoning: !!options.reasoning,
    });
    process.exit(code);
  });

program.parse();
