// INERT proposal: produces a separate collection and chapter pages from exact
// approved presentation bodies. It never changes annual papers or their index.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const slug = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

function checked(ref) {
  assert(ref && /^[0-9a-f]{64}$/.test(ref.sha256));
  assert(Number.isSafeInteger(ref.bytes) && ref.bytes >= 0);
  const bytes = fs.readFileSync(ref.file);
  assert.equal(bytes.length, ref.bytes, ref.file);
  assert.equal(sha(bytes), ref.sha256, ref.file);
  return bytes;
}

function body(ref) {
  const bytes = checked(ref);
  const text = bytes.toString('utf8');
  assert(Buffer.from(text, 'utf8').equals(bytes), 'Lossless UTF8 body');
  assert(
    !/(?:file:\/\/|(?<![A-Za-z0-9])[A-Za-z]:[\\/])/.test(text),
    'Unresolved private path'
  );
  return text;
}

function html(value) {
  return String(value).replace(
    /[&<>"{}]/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '{': '&#123;',
        '}': '&#125;',
      }[c])
  );
}

function footer(documentUrl, label, pages) {
  return `<p>${html(label)}: ${pages
    .map(page => `<a href="${html(documentUrl)}#page=${page}">PDF ${page}</a>`)
    .join(', ')}</p>`;
}

function nativeAssets(task, role, text, collectionId) {
  return (task.nativeAssets ?? [])
    .filter(asset => asset.role === role)
    .map(asset => {
      const original = checked(asset.original);
      const copy = checked(asset.privateCopy);
      assert(original.equals(copy), 'Native asset encoded bytes');
      assert.equal(copy.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(copy.subarray(12, 16).toString(), 'IHDR');
      assert.equal(copy.readUInt32BE(16), asset.width);
      assert.equal(copy.readUInt32BE(20), asset.height);
      checked(asset.sourceBinding.container);
      assert(
        (role === 'question'
          ? task.questionNativePages
          : task.keyNativePages
        ).includes(asset.nativePage)
      );
      assert.equal(
        asset.url,
        `/collections/${collectionId}/assets/${asset.original.sha256}.png`
      );
      if (asset.display === 'already-in-body') {
        assert(text.includes(asset.url), 'Declared existing asset destination');
        return '';
      }
      if (asset.display === 'detail-only') {
        return `<p><a href="${asset.url}">Source detail, PDF ${asset.nativePage}</a></p>`;
      }
      assert.equal(asset.display, 'append-to-body');
      assert(
        !text.includes(asset.url),
        'Do not append a second existing placement'
      );
      return `<figure><img src="${asset.url}" width="${asset.width}" height="${asset.height}" alt="Original source figure, PDF ${asset.nativePage}" /></figure>`;
    })
    .join('\n\n');
}

function nativeContext(chapter, placement, taskId, documentUrl) {
  return (chapter.contextBlocks ?? [])
    .filter(block => block.placement === placement && block.taskId === taskId)
    .map(
      block =>
        body(block.body) +
        '\n\n' +
        footer(documentUrl, 'Source context', block.nativePages)
    )
    .join('\n\n');
}

function annualLinks(task) {
  const relation = task.annualCorrespondence;
  if (relation.status === 'unestablished') return '';
  checked(relation.evidence);
  assert(relation.links.filter(link => link.primary).length === 1);
  const primary = relation.links.find(link => link.primary);
  assert(
    primary.language === 'bg' ||
      !relation.links.some(link => link.language === 'bg'),
    'Use the approved Bulgarian primary when this task has one'
  );
  const links = [...relation.links].sort(
    (a, b) => Number(b.primary) - Number(a.primary)
  );
  const label =
    relation.status === 'same-original'
      ? 'Същата оригинална задача'
      : 'Свързана годишна задача; редактиран вариант';
  return `<p>${label}: ${links
    .map(link => {
      assert(link.url.startsWith('/problems/') && !link.url.includes('"'));
      return `<a href="${html(link.url)}" lang="${html(link.language)}">${html(
        link.label
      )}</a>`;
    })
    .join(' · ')}</p>`;
}

export function renderCollection(
  document,
  schemaFile,
  privateSourceCopy = null
) {
  const Ajv = require('ajv');
  const validate = new Ajv({ allErrors: true }).compile(
    JSON.parse(fs.readFileSync(schemaFile, 'utf8'))
  );
  assert(validate(document), JSON.stringify(validate.errors));
  const c = document.collection;
  assert(slug(c.id));
  if (c.publicationYear !== null) checked(c.publicationYearEvidence);
  checked(document.source.document);
  checked(document.source.conditionsEvidence);
  let documentUrl;
  if (privateSourceCopy !== null) {
    assert.equal(
      document.source.publicUrl,
      null,
      'Private view is not a public measurement'
    );
    const copy = checked(privateSourceCopy);
    assert(
      copy.equals(checked(document.source.document)),
      'Exact original private source copy'
    );
    documentUrl = `/collections/${c.id}/source/${document.source.document.sha256}.pdf`;
  } else {
    assert(
      document.source.publicUrl,
      'A measured source URL is required before generation'
    );
    const sourceURL = new URL(document.source.publicUrl);
    assert.equal(sourceURL.protocol, 'https:');
    assert.equal(sourceURL.hash, '');
    documentUrl = document.source.publicUrl;
    assert(
      document.tasks.every(task => (task.nativeAssets ?? []).length === 0),
      'Private source-asset descriptors need a separately approved public successor'
    );
  }
  const chapterIds = new Set(document.chapters.map(chapter => chapter.id));
  assert.equal(chapterIds.size, document.chapters.length);
  const ids = new Set();
  for (const task of document.tasks) {
    assert(slug(task.id) && !ids.has(task.id));
    ids.add(task.id);
    assert(chapterIds.has(task.chapterId));
    checked(task.sourceTask.container);
    assert(task.presentation, `Missing complete presentation: ${task.id}`);
    checked(task.presentation.completeSourceNoLoss);
    for (const page of [...task.questionNativePages, ...task.keyNativePages]) {
      assert(page >= 1 && page <= document.source.pageCount);
    }
  }
  const route = `/collections/${c.id}/`;
  const entry = {
    id: c.id,
    kind: 'collection',
    title: c.title,
    url: route,
    subject: c.subject,
    competition: c.competition,
    language: c.language,
    publicationYear: c.publicationYear,
    contestYears: c.contestYears,
    chapterTitles: document.chapters.map(chapter => chapter.title),
    taskCount: document.tasks.length,
    printedTags: [...new Set(document.tasks.flatMap(task => task.printedTags))],
  };
  const chapters = document.chapters.map(chapter => ({
    id: chapter.id,
    title: chapter.title,
    url: `${route}${chapter.id}/`,
  }));
  const context = {
    collection: entry,
    attribution: document.source.attribution,
    printedConditions: document.source.printedConditions,
    chapters,
  };
  const frontmatter = id =>
    `---\nid: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(
      c.title
    )}\n---\n\n`;
  const pages = [
    {
      file: `${c.id}.mdx`,
      url: route,
      context: {
        ...context,
        id: `collection-${c.id}`,
        chapterId: null,
        taskSections: [],
      },
      mdx:
        frontmatter(`collection-${c.id}`) +
        body(document.introduction) +
        '\n\n' +
        body(document.referenceAppendix),
    },
  ];
  for (const chapter of document.chapters) {
    const chapterTasks = document.tasks.filter(
      task => task.chapterId === chapter.id
    );
    const chapterTaskIds = new Set(chapterTasks.map(task => task.id));
    for (const block of chapter.contextBlocks ?? []) {
      assert(slug(block.id));
      assert(block.taskId === null || chapterTaskIds.has(block.taskId));
      assert(
        block.nativePages.every(
          page => page >= 1 && page <= document.source.pageCount
        )
      );
      assert(
        ['prefix', 'suffix'].includes(block.placement) ===
          (block.taskId === null)
      );
    }
    const taskSections = [
      ...new Set(chapterTasks.map(task => task.section)),
    ].map(section => ({
      section,
      tasks: chapterTasks
        .filter(task => task.section === section)
        .map(task => ({
          id: task.id,
          printedNumber: task.printedNumber,
          printedTags: task.printedTags,
        })),
    }));
    const sectionId = section =>
      `native-section-${section.replace(/[^a-z0-9-]/gi, '-')}`;
    assert.equal(
      new Set(taskSections.map(group => sectionId(group.section))).size,
      taskSections.length
    );
    const blocks = chapterTasks.map(task => {
      const question = body(task.presentation.question);
      const key = body(task.presentation.key);
      const id = task.id;
      let keySourceWarning = '';
      if (c.id === 'ioaa-problems-by-topic' && id === 'c3-ga-t01') {
        assert.deepEqual(task.keyNativePages, [135]);
        assert.equal(task.nativeAssets.length, 0);
        assert(key.includes('See figure.'));
        keySourceWarning =
          '<p role="note">В предоставения сборник липсва фигурата, към която препраща решението.</p>\n\n';
      }
      const tag = task.printedTags.map(html).join(' · ');
      const firstInSection =
        chapterTasks.find(item => item.section === task.section).id === id;
      const heading = firstInSection
        ? `<h2 id="${sectionId(task.section)}">${html(task.section)}</h2>\n\n`
        : '';
      return (
        heading +
        `<section id="${id}">\n\n### ${html(task.section)} · ${html(
          task.printedNumber
        )}\n\n` +
        `<p>${tag}</p>\n\n${annualLinks(task)}\n\n` +
        `<h4 id="${id}-question">Условие</h4>\n\n${nativeContext(
          chapter,
          'before-question',
          id,
          documentUrl
        )}\n\n${question}\n\n${nativeAssets(
          task,
          'question',
          question,
          c.id
        )}\n\n` +
        `${footer(documentUrl, 'Условие', task.questionNativePages)}\n\n` +
        `<details id="${id}-key">\n\n<summary>Печатно решение / форма</summary>\n\n${nativeContext(
          chapter,
          'before-key',
          id,
          documentUrl
        )}\n\n${key}\n\n${nativeAssets(task, 'key', key, c.id)}\n\n` +
        `${keySourceWarning}${footer(
          documentUrl,
          'Решение',
          task.keyNativePages
        )}\n\n</details>\n\n</section>`
      );
    });
    const id = `collection-${c.id}-${chapter.id}`;
    pages.push({
      file: `${c.id}-${chapter.id}.mdx`,
      url: `${route}${chapter.id}/`,
      context: { ...context, id, chapterId: chapter.id, taskSections },
      mdx:
        frontmatter(id) +
        nativeContext(chapter, 'prefix', null, documentUrl) +
        '\n\n' +
        blocks.join('\n\n') +
        '\n\n' +
        nativeContext(chapter, 'suffix', null, documentUrl),
    });
  }
  return { entry, pages };
}

// Explicit output root; this proposal is not wired into ship or build scripts.
// The future publisher supplies a new directory and a complete approved input.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [input, output, schema, privateSourceFile] = process.argv.slice(2);
  assert(input && output && schema && [5, 6].includes(process.argv.length));
  assert(!fs.existsSync(output), 'Output must be fresh');
  const privateSourceCopy = privateSourceFile
    ? JSON.parse(fs.readFileSync(privateSourceFile, 'utf8'))
    : null;
  const result = renderCollection(
    JSON.parse(fs.readFileSync(input, 'utf8')),
    schema,
    privateSourceCopy
  );
  fs.mkdirSync(output, { recursive: true });
  for (const page of result.pages) {
    fs.writeFileSync(path.join(output, page.file), page.mdx);
  }
  fs.writeFileSync(
    path.join(output, 'index.json'),
    JSON.stringify(
      {
        entries: [result.entry],
        pages: result.pages.map(({ mdx, ...page }) => page),
      },
      null,
      2
    ) + '\n'
  );
}
