import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, Github, Globe2 } from 'lucide-react';
import { QqGroupCopy } from '@/components/qq-group-copy';
import { localizePath, type Locale } from '@/lib/i18n';
import { appNames, gitConfig } from '@/lib/shared';

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const officialUrl = 'https://usa0.top';

const messages = {
  en: {
    eyebrow: 'AI canvas creation workspace',
    center: 'Documentation',
    description: 'USA零 brings canvas composition, AI generation, reference editing, prompt libraries, and reusable assets into one continuous creative workflow.',
    quickStart: 'Quick Start',
    official: 'Official Website',
    repository: 'GitHub Repository',
    guideTitle: 'Start creating',
    guideDescription: 'Configure your model providers, create a canvas, and organize prompts, references, and generated results in one place.',
    features: 'Explore Features',
  },
  'zh-CN': {
    eyebrow: 'AI 画布创作工作台',
    center: '文档中心',
    description: 'USA零 将画布编排、AI 生成、参考图编辑、提示词库和素材沉淀放进同一个连续创作工作流。',
    quickStart: '快速开始',
    official: 'USA零 官网',
    repository: 'GitHub 仓库',
    guideTitle: '开始创作',
    guideDescription: '配置模型渠道、创建画布，并在一个工作台中组织提示词、参考素材和生成结果。',
    features: '查看功能介绍',
  },
};

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-10 md:px-10 md:pt-16">
      <section className="grid min-h-[500px] items-center gap-12 border-b border-zinc-200 pb-14 dark:border-zinc-800 lg:grid-cols-[1fr_0.72fr]">
        <div>
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{text.eyebrow}</div>
          <h1 className="mt-6 text-5xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-7xl [font-family:var(--font-display)]">
            {appNames[locale]}
            <span className="mt-2 block text-zinc-500 dark:text-zinc-400">{text.center}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">{text.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={localizePath(locale, '/docs/overview/quick-start')} className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
              <BookOpen className="size-4" />
              {text.quickStart}
            </Link>
            <a href={officialUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900">
              <Globe2 className="size-4" />
              {text.official}
            </a>
            <QqGroupCopy chinese={locale === 'zh-CN'} />
          </div>
        </div>
        <img src="/logo.png" alt={appNames[locale]} className="mx-auto aspect-square w-full max-w-[380px] object-contain" />
      </section>

      <section className="grid gap-8 py-14 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h2 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{text.guideTitle}</h2>
          <p className="mt-3 max-w-3xl text-base leading-8 text-zinc-600 dark:text-zinc-400">{text.guideDescription}</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm font-medium">
          <Link href={localizePath(locale, '/docs/overview/features')} className="inline-flex items-center gap-1.5 text-zinc-900 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300">
            {text.features}<ArrowUpRight className="size-4" />
          </Link>
          <a href={githubUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-900 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300">
            <Github className="size-4" />{text.repository}
          </a>
        </div>
      </section>
    </main>
  );
}

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];
  return {
    title: `${appNames[locale]} ${text.center}`,
    description: text.description,
    alternates: { languages: { en: '/', 'zh-CN': '/zh-CN' } },
  };
}
