import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepositoryFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const readme = readRepositoryFile('README.md');
const chineseGuide = readRepositoryFile('docs/user-guide.zh-CN.md');
const englishGuide = readRepositoryFile('docs/user-guide.en.md');
const privacy = readRepositoryFile('docs/privacy.md');
const limitations = readRepositoryFile('docs/known-limitations.md');

describe('M10 release documentation', () => {
  it('links both user guides, privacy, and known limitations from the repository entry point', () => {
    for (const path of [
      './docs/user-guide.zh-CN.md',
      './docs/user-guide.en.md',
      './docs/privacy.md',
      './docs/known-limitations.md',
    ]) {
      expect(readme).toContain(path);
    }
    expect(readme).toContain('does not crawl an entire site');
    expect(readme).toContain('P0 release blockers');
  });

  it('documents the real current-page workflow in Chinese and English', () => {
    for (const guide of [chineseGuide, englishGuide]) {
      expect(guide).toContain('0-30,000');
      expect(guide).toContain('1-12');
      expect(guide).toContain('python3 -m http.server 8000 --bind 127.0.0.1');
      expect(guide).toContain('http://127.0.0.1:8000/');
      expect(guide).toContain('ZIP');
    }

    expect(chineseGuide).toContain('授权所选项');
    expect(chineseGuide).toContain('只归档当前页面');
    expect(englishGuide).toContain('Grant selected');
    expect(englishGuide).toContain('does not crawl');
  });

  it('discloses local processing, sensitive-data handling, permissions, and user responsibility', () => {
    for (const required of [
      'does not upload captured HTML',
      'credentials omitted',
      'Current form values',
      '`activeTab`',
      '`scripting`',
      '`storage`',
      '`downloads`',
      '`offscreen`',
      '`sidePanel`',
      'Optional HTTP/HTTPS host access',
      'copyright law',
      '不会把 HTML',
      '不得用本扩展绕过技术访问控制',
    ]) {
      expect(privacy).toContain(required);
    }
  });

  it('keeps release blockers and unsupported behavior visible in both languages', () => {
    for (const required of [
      '81.82%',
      '0%',
      '_sitecapsule/report.html',
      'maxDepth=0',
      'maxPages=1',
      'Cross-origin iframe',
      '跨域 iframe',
      'Canvas/WebGL',
      'file:///docs/',
      'in-memory Blob',
      '内存 Blob',
      'must not be claimed',
      '不应宣称已达标',
    ]) {
      expect(limitations).toContain(required);
    }
  });
});
