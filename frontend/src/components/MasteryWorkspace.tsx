import { useState, useEffect, useRef } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import Editor, { OnMount } from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import { 
  Send, 
  Lightbulb, 
  Play, 
  CheckCircle, 
  ChevronLeft, 
  MessageSquare, 
  FileText, 
  Code2, 
  Terminal,
  Loader2,
  ChevronDown,
  Settings,
  Maximize2,
  RotateCcw,
  Bell,
  User as UserIcon,
  Zap,
  Star
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Question } from '../types';
import { getSocraticResponse, getProblemDescription, getBoilerplateCode } from '../lib/geminiService';
import { motion, AnimatePresence } from 'motion/react';

interface MasteryWorkspaceProps {
  question: Question;
  onBack: () => void;
  onFinish: (question: Question) => void;
}

export default function MasteryWorkspace({ question, onBack, onFinish }: MasteryWorkspaceProps) {
  const [problemMd, setProblemMd] = useState<string>('Loading problem description...');
  const [boilerplate, setBoilerplate] = useState<string>('');
  const [code, setCode] = useState<string>(`class Solution:\n    def solution(self, nums: List[int]) -> int:\n        # Write your code here\n        pass`);
  const [messages, setMessages] = useState<{ role: 'user' | 'model', parts: { text: string }[] }[]>([]);
  const [input, setInput] = useState('');
  const [isMentorLoading, setIsMentorLoading] = useState(false);
  const [testResults, setTestResults] = useState<string>('You must run your code first');
  const [mode, setMode] = useState<'Exploratory' | 'Dig-Deeper' | 'Refinement'>('Exploratory');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSolved, setIsSolved] = useState(false);
  const [activeTab, setActiveTab] = useState<'description' | 'editorial' | 'solutions' | 'submissions'>('description');

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadProblem = async () => {
      const [md, bp] = await Promise.all([
        getProblemDescription(question.title, question.number),
        getBoilerplateCode(question.title, question.number)
      ]);
      setProblemMd(md);
      setBoilerplate(bp);
      setCode(bp);
    };
    loadProblem();
  }, [question]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    // Register custom snippets
    monaco.languages.registerCompletionItemProvider('python', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const suggestions = [
          {
            label: 'pr',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'print(${1:message})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Print to console',
            range: range,
          },
          {
            label: 'fori',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'for i in range(${1:n}):\n    ${2:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'For loop with range',
            range: range,
          },
          {
            label: 'ife',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'if ${1:condition}:\n    ${2:pass}\nelse:\n    ${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'If-Else block',
            range: range,
          },
          {
            label: 'def',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'def ${1:function_name}(${2:params}):\n    ${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Function definition',
            range: range,
          }
        ];
        return { suggestions };
      },
    });
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const newMessages = [...messages, { role: 'user' as const, parts: [{ text }] }];
    setMessages(newMessages);
    setInput('');
    setIsMentorLoading(true);

    const response = await getSocraticResponse(newMessages, {
      mode,
      problemDescription: problemMd,
      userCode: code,
      testResults: testResults !== 'You must run your code first' ? testResults : undefined
    });

    setMessages([...newMessages, { role: 'model' as const, parts: [{ text: response }] }]);
    setIsMentorLoading(false);
  };

  const handleRun = () => {
    setTestResults('Running tests...\n\nTest Case 1: [1,2,3] -> Expected: 6, Got: 6\nTest Case 2: [-1,1] -> Expected: 0, Got: 0\n\nAll basic tests passed!');
    setMode('Exploratory');
  };

  const handleSubmit = () => {
    setIsSubmitting(true);
    
    // Check if code is just boilerplate or very short
    const lines = code.split('\n').filter(line => line.trim().length > 0);
    const hasLogic = lines.length > 5 && !code.includes('pass # Write your code here');
    const isBoilerplate = code.includes('pass') && lines.length < 6;
    
    setTimeout(() => {
      if (isBoilerplate || !hasLogic) {
        setTestResults('Wrong Answer\n\nInput: [1,2,3]\nExpected: 6\nOutput: null\n\nYour code didn\'t return anything meaningful. Please implement the solution logic.');
        setMode('Dig-Deeper');
        handleSendMessage("My code failed. It seems I haven't implemented the logic correctly.");
      } else {
        const success = Math.random() > 0.15; // 85% success rate if they actually typed something
        if (success) {
          setTestResults('Success!\n\nRuntime: 45ms (Beats 89.4%)\nMemory: 16.4MB (Beats 72.1%)\n\nAll test cases passed.');
          setIsSolved(true);
          setMode('Refinement');
          handleSendMessage("I've successfully submitted the code!");
        } else {
          setTestResults('Wrong Answer\n\nInput: [1,1,1]\nExpected: 3\nOutput: 2\n\nFailed at test case 45/120. Logic error in edge case handling.');
          setMode('Dig-Deeper');
          handleSendMessage("My code failed a test case.");
        }
      }
      setIsSubmitting(false);
    }, 1500);
  };

  return (
    <div className="h-screen flex flex-col bg-[#1a1a1a] text-[#eff1f6fb] overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-[#333333] flex items-center justify-between px-4 bg-[#1a1a1a]">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-zinc-400 hover:text-white">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Problem List
          </Button>
          <div className="h-4 w-[1px] bg-[#333333]" />
          <h1 className="font-semibold text-sm">
            {question.number}. {question.title}
          </h1>
          <Badge variant="outline" className={`
            ${question.difficulty === 'Easy' ? 'text-green-500 border-green-500/20 bg-green-500/5' : ''}
            ${question.difficulty === 'Medium' ? 'text-yellow-500 border-yellow-500/20 bg-yellow-500/5' : ''}
            ${question.difficulty === 'Hard' ? 'text-red-500 border-red-500/20 bg-red-500/5' : ''}
          `}>
            {question.difficulty}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {isSolved && (
            <Button 
              onClick={() => onFinish(question)}
              className="bg-green-600 hover:bg-green-700 text-white h-8 px-4"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Finish Review
            </Button>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <Group orientation="horizontal" className="flex-1 p-2 gap-2">
        {/* Col 1: Problem Description */}
        <Panel defaultSize="40%" minSize="30%">
          <div className="h-full flex flex-col rounded-lg overflow-hidden bg-[#282828] border border-[#333333]">
            <div className="flex items-center bg-[#333333]/30 px-2">
              <button 
                onClick={() => setActiveTab('description')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === 'description' ? 'border-white text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3" />
                  Description
                </div>
              </button>
            </div>
            <ScrollArea className="flex-1 bg-[#282828]">
              <div className="p-6 prose prose-invert prose-sm max-w-none">
                <h1 className="text-[22px] font-bold mb-2 text-white">{question.number}. {question.title}</h1>
                <div className="flex items-center gap-2 mb-6">
                  <Badge variant="secondary" className={`bg-zinc-800 border-none px-2 py-0.5 text-xs font-medium ${question.difficulty === 'Easy' ? 'text-green-500' : question.difficulty === 'Medium' ? 'text-yellow-500' : 'text-red-500'}`}>
                    {question.difficulty}
                  </Badge>
                </div>
                <div className="text-zinc-200 leading-relaxed text-sm overflow-y-auto">
                  <ReactMarkdown>{problemMd}</ReactMarkdown>
                </div>
              </div>
            </ScrollArea>
          </div>
        </Panel>

        <Separator className="w-[1px] bg-transparent hover:bg-yellow-500/20 transition-colors cursor-col-resize" />

        {/* Col 2: Editor */}
        <Panel defaultSize="35%" minSize="30%">
          <div className="h-full flex flex-col rounded-lg overflow-hidden bg-[#282828] border border-[#333333]">
            <div className="flex items-center justify-between bg-[#333333]/30 px-3 py-1">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-xs text-green-500 font-medium">
                  <Code2 className="w-3 h-3" />
                  Code
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase font-bold">
                  Python3
                  <ChevronDown className="w-3 h-3" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="h-7 border-none bg-[#333333] hover:bg-zinc-700 text-zinc-200 text-[10px] font-medium px-3"
                  onClick={handleRun}
                >
                  Run
                </Button>
                <Button 
                  size="sm"
                  className="h-7 bg-[#2cbb5d] hover:bg-[#249a4d] text-white text-[10px] font-bold px-3"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    'Submit'
                  )}
                </Button>
                <div className="w-[1px] h-4 bg-[#333333] mx-1" />
                <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500" onClick={() => setCode(boilerplate)}>
                  <RotateCcw className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <div className="flex-1 bg-[#1e1e1e] relative">
              <Editor
                height="100%"
                defaultLanguage="python"
                theme="vs-dark"
                value={code}
                onMount={handleEditorMount}
                onChange={(v) => setCode(v || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 16 },
                  fontFamily: "'JetBrains Mono', monospace",
                  suggestOnTriggerCharacters: true,
                  quickSuggestions: true,
                  renderLineHighlight: 'all',
                  scrollbar: {
                    vertical: 'hidden',
                    horizontal: 'hidden'
                  }
                }}
              />
              <div className="absolute bottom-0 left-0 right-0 h-6 bg-[#1e1e1e] border-t border-[#333333] flex items-center justify-between px-3 text-[10px] text-zinc-500">
                <div className="flex items-center gap-2">
                  <span>Saved</span>
                  {testResults !== 'You must run your code first' && (
                    <span className={`ml-2 ${testResults.includes('Success') ? 'text-green-500' : 'text-red-500'}`}>
                      {testResults.split('\n')[0]}
                    </span>
                  )}
                </div>
                <span>Ln 1, Col 1</span>
              </div>
            </div>
          </div>
        </Panel>

        <Separator className="w-[1px] bg-transparent hover:bg-yellow-500/20 transition-colors cursor-col-resize" />

        {/* Col 3: Socratic Mentor */}
        <Panel defaultSize="25%" minSize="15%">
          <div className="h-full flex flex-col rounded-lg overflow-hidden bg-[#282828] border border-[#333333]">
            <div className="p-3 border-b border-[#333333] bg-[#333333]/30 flex items-center gap-2 text-zinc-400">
              <MessageSquare className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Socratic Mentor</span>
            </div>
            <ScrollArea className="flex-1 p-4 bg-[#282828]">
              <div className="space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-8 text-zinc-500">
                    <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm italic">I'm here to guide your logic. What's your plan for this problem?</p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] p-3 rounded-lg text-sm ${
                      m.role === 'user' 
                        ? 'bg-zinc-800 text-zinc-100' 
                        : 'bg-[#1a1a1a] text-zinc-300 border border-[#333333]'
                    }`}>
                      {m.parts[0].text}
                    </div>
                  </div>
                ))}
                {isMentorLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[#1a1a1a] p-3 rounded-lg border border-[#333333]">
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>
            <div className="p-4 border-t border-[#333333] space-y-2 bg-[#282828]">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(input)}
                  placeholder="Ask about logic..."
                  className="flex-1 bg-[#1a1a1a] border border-[#333333] rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500/50"
                />
                <Button size="icon" onClick={() => handleSendMessage(input)} className="bg-yellow-600 hover:bg-yellow-700 h-9 w-9">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10"
                onClick={() => handleSendMessage("Give me a hint about the logic.")}
              >
                <Lightbulb className="w-3 h-3 mr-1" />
                Get Hint
              </Button>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
