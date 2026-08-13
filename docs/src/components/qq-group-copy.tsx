'use client';

import { Check, MessageCircle } from 'lucide-react';
import { useState } from 'react';

const QQ_GROUP = '1084450051';

export function QqGroupCopy({ chinese = false }: { chinese?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(QQ_GROUP);
    } catch {
      const input = document.createElement('textarea');
      input.value = QQ_GROUP;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
    >
      {copied ? <Check className="size-4" /> : <MessageCircle className="size-4" />}
      {copied ? (chinese ? '群号已复制' : 'Group copied') : `Q群 ${QQ_GROUP}`}
    </button>
  );
}
