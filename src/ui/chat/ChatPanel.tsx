import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';

import { AGENTKIT_CONTEXT } from '../../chat/agentkit-context.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  onExit: () => void;
  isFocused: boolean;
  width?: number;
  height?: number;
}

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content:
    'Hello! Ask me anything about AgentKit.\n\nTop questions you can ask:\n' +
    '1. How do I push a story to the queue?\n' +
    '2. How do I start/stop the pipeline?\n' +
    '3. A story is stuck — what do I do?\n' +
    '4. How do I reset a story to an earlier stage?\n' +
    '5. How do I view task logs?\n' +
    '6. What does loop_blocked mean?\n' +
    '7. How do I switch teams?\n' +
    '8. How do I cancel a story?\n' +
    '9. How do I load stories from a file?\n' +
    '10. How do I mark a task as done manually?',
};

function truncateLines(text: string, maxWidth: number): string {
  if (!maxWidth || maxWidth <= 0) return text;
  return text
    .split('\n')
    .map((line) => (line.length > maxWidth - 2 ? line.slice(0, maxWidth - 3) + '…' : line))
    .join('\n');
}

export function ChatPanel({
  onExit,
  isFocused,
  width,
  height,
}: ChatPanelProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const procRef = useRef<ReturnType<typeof spawn> | null>(null);

  // Kill any running claude process on unmount
  useEffect(() => {
    return () => {
      if (procRef.current) {
        try { procRef.current.kill(); } catch { /* ignore */ }
      }
    };
  }, []);

  const sendMessage = useCallback(
    (text: string): void => {
      const newMessages: Message[] = [...messages, { role: 'user', content: text }];
      setMessages(newMessages);
      setInputText('');
      setIsLoading(true);
      setStreamingText('');

      // Build full prompt: context + conversation history
      const history = newMessages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      const fullPrompt = `${AGENTKIT_CONTEXT}\n\nConversation:\n${history}\n\nAssistant:`;

      let response = '';
      const proc = spawn('claude', ['-p', fullPrompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      procRef.current = proc;

      proc.stdout?.on('data', (chunk: Buffer) => {
        response += chunk.toString();
        setStreamingText(response);
      });

      proc.stderr?.on('data', () => {
        // suppress stderr
      });

      proc.on('close', (code) => {
        procRef.current = null;
        if (code !== 0 && response === '') {
          response = '(Error: claude CLI returned non-zero. Is it installed and authenticated?)';
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: response.trim() }]);
        setStreamingText('');
        setIsLoading(false);
      });

      proc.on('error', () => {
        procRef.current = null;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '(Error: could not spawn claude CLI)' },
        ]);
        setStreamingText('');
        setIsLoading(false);
      });
    },
    [messages],
  );

  useInput(
    (input, key) => {
      // Q or q to exit, but only if not typing (inputText is empty)
      // This matches Epic 16 navigation rules while allowing 'q' in messages.
      if ((input === 'q' || input === 'Q') && inputText === '') {
        onExit();
        return;
      }

      // Escape is explicitly disabled per Epic 16 navigation rules
      if (key.escape) {
        return;
      }

      if (isLoading) return;

      if (key.return) {
        const trimmed = inputText.trim();
        if (trimmed) sendMessage(trimmed);
        return;
      }

      if (key.backspace || key.delete) {
        setInputText((t) => t.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta && !key.tab) {
        setInputText((t) => t + input);
      }
    },
    { isActive: isFocused },
  );

  // Calculate visible message area height
  // 2 border + 1 header + 1 input line + 1 footer = 5 overhead
  const OVERHEAD = 5;
  const availableHeight = height != null ? Math.max(2, height - OVERHEAD) : 12;
  const displayWidth = width ?? 60;

  // Build display lines from messages + streaming
  const allMsgs = streamingText
    ? [...messages, { role: 'assistant' as const, content: streamingText + '▌' }]
    : messages;

  // Flatten all messages into lines
  const allLines: Array<{ role: 'user' | 'assistant'; line: string }> = [];
  for (const msg of allMsgs) {
    const prefix = msg.role === 'user' ? 'You: ' : 'Agent: ';
    const body = truncateLines(msg.content, displayWidth - prefix.length);
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      allLines.push({ role: msg.role, line: i === 0 ? prefix + line : '      ' + line });
    });
    allLines.push({ role: msg.role, line: '' }); // blank separator
  }

  const visibleLines = allLines.slice(-availableHeight);

  return (
    <Box
      borderStyle="round"
      borderColor={isFocused ? 'cyan' : 'gray'}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
    >
      <Text bold> AgentKit Agent{isLoading ? <Text color="yellow"> ⟳ thinking...</Text> : ''}</Text>
      <Box flexDirection="column" overflow="hidden" flexGrow={1}>
        {visibleLines.map((item, i) =>
          item.line === '' ? (
            <Text key={i}> </Text>
          ) : (
            <Text
              key={i}
              color={item.role === 'user' ? 'cyan' : 'white'}
              wrap="truncate"
            >
              {item.line}
            </Text>
          ),
        )}
      </Box>
      <Box>
        <Text color={isFocused ? 'cyan' : 'gray'}>{'> '}</Text>
        <Text>{inputText}</Text>
        {isFocused && <Text color="cyan">█</Text>}
      </Box>
      <Text dimColor> [Enter] Send  [Q] Back to menu</Text>
    </Box>
  );
}
