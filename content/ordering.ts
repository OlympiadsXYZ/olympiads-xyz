// Section -> Chapter -> Module


export type SectionID =
  // | 'general'
  // | 'bronze'
  // | 'silver'
  // | 'gold'
  // | 'plat'
  // | 'adv'
  | 'general'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'special'
  | 'beyond';

export type Chapter = {
  name: string;
  items: string[];
  description?: string;
};

const MODULE_ORDERING: { [key in SectionID]: Chapter[] } = {
  general: [
    {
      name: 'Getting Started',
      description: "Start here if you're new to competitive programming.",
      items: [
        'general-test',
        'using-this-guide',
        'intro-cp',
        'choosing-lang',
        'resources-learning-to-code',
        'running-code-online',
        'data-types',
        'input-output',
        'expected-knowledge',
      ],
    },
    {
      name: 'Contributing',
      description: 'How you can add content to the guide.',
      items: ['contributing', 'adding-solution', 'modules', 'working-mdx'],
    },
    {
      name: 'General Resources',
      description: 'Useful for competitors of all levels.',
      items: [
        'debugging-checklist',
        'practicing',
        'contest-strategy',
        'resources-cp',
        'contests',
        'olympiads',
      ],
    },
    {
      name: 'Language-Specific',
      description:
        'Setup instructions and discussion of language-specific features.',
      items: [
        'running-code-locally',
        'cpp-command',
        'fast-io',
        'basic-debugging',
        'debugging-cpp',
        'generic-code',
        'lambda-funcs',
      ],
    },
    {
      name: 'USA',
      description:
        'Information specific to USACO as well as USA camps and contests.',
      items: ['usaco-faq', 'usaco-monthlies', 'usaco-camp', 'resources-usa'],
    },
  ],
  beginner: [
    {
      name: 'Getting Started',
      items: ['time-comp', 'intro-ds', 'simulation'],
    },
    {
      name: 'Complete Search',
      items: ['intro-complete', 'complete-rec'],
    },
    {
      name: 'Sorting & Sets',
      items: ['intro-sorting', 'intro-sets'],
    },
    {
      name: 'Additional',
      items: ['ad-hoc', 'intro-greedy', 'intro-graphs', 'rect-geo'],
    },
    {
      name: 'Conclusion',
      description: 'Congratulations on making it this far!',
      items: ['bronze-conclusion'],
    },
  ],
  intermediate: [
    {
      name: 'Prefix Sums',
      items: ['prefix-sums', 'more-prefix-sums'],
    },
    {
      name: 'Sorting & Searching',
      items: [
        'sorting-custom',
        'two-pointers',
        'intro-sorted-sets',
        'custom-cpp-stl',
        'greedy-sorting',
        'binary-search',
      ],
    },
    {
      name: 'Graphs',
      description:
        'Most Silver to Platinum contests have at least one graph problem.',
      items: ['graph-traversal', 'flood-fill', 'intro-tree', 'func-graphs'],
    },
    {
      name: 'Additional Topics',
      items: ['intro-bitwise'],
    },
    {
      name: 'Conclusion',
      description: 'Congratulations on making it this far!',
      items: ['silver-conclusion'],
    },
  ],
  advanced: [
    {
      name: 'Math',
      items: ['divisibility', 'modular', 'combo'],
    },
    {
      name: 'Dynamic Programming',
      description:
        'Most Gold and Platinum contests have at least one DP problem.',
      items: [
        'intro-dp',
        'knapsack',
        'paths-grids',
        'lis',
        'dp-bitmasks',
        'dp-ranges',
        'digit-dp',
      ],
    },
    {
      name: 'Graphs',
      description:
        'Most Silver to Platinum contests have at least one graph problem.',
      items: [
        'unweighted-shortest-paths',
        'dsu',
        'toposort',
        'shortest-paths',
        'mst',
      ],
    },
    {
      name: 'Data Structures',
      items: ['stacks', 'sliding-window', 'PURS'],
    },
    {
      name: 'Trees',
      items: ['tree-euler', 'dp-trees', 'all-roots'],
    },
    {
      name: 'Additional Topics',
      description: 'Rarely required.',
      items: ['hashing', 'hashmaps', 'meet-in-the-middle'],
    },
    {
      name: 'Conclusion',
      description: 'Congratulations on making it this far!',
      items: ['gold-conclusion'],
    },
  ],
  special: [
    {
      name: 'Range Queries',
      items: [
        'segtree-ext',
        'range-sweep',
        'RURQ',
        'sparse-segtree',
        '2DRQ',
        'DC-SRQ',
        'sqrt',
      ],
    },
    {
      name: 'Trees',
      items: ['binary-jump', 'merging', 'hld', 'centroid'],
    },
    {
      name: 'Geometry',
      items: ['geo-pri', 'sweep-line', 'convex-hull', 'convex-hull-trick'],
    },
    {
      name: 'Misc. Topics',
      items: ['PIE', 'matrix-expo', 'bitsets', 'DC-DP'],
    },
    {
      name: 'Conclusion',
      items: ['plat-conclusion'],
    },
  ],
  beyond: [
    {
      name: 'Data Structures',
      items: [
        'springboards',
        'wavelet',
        'count-min',
        'segtree-beats',
        'persistent',
        'treaps',
      ],
    },
    {
      name: 'Convexity',
      items: ['line-container', 'lagrange', 'slope-trick'],
    },
    {
      name: 'Graphs',
      items: [
        'sp-neg',
        'eulerian-tours',
        'BCC-2CC',
        'SCC',
        'offline-del',
        'eulers-formula',
        'critical',
        'link-cut-tree',
      ],
    },
    {
      name: 'Dynamic Programming',
      items: ['comb-sub', 'dp-more', 'dp-sos'],
    },
    {
      name: 'Flows',
      items: ['max-flow', 'min-cut', 'flow-lb', 'min-cost-flow'],
    },
    {
      name: 'Polynomials',
      items: ['fft', 'fft-ext'],
    },
    {
      name: 'Strings',
      items: ['string-search', 'suffix-array', 'string-suffix'],
    },
    {
      name: 'Misc. Topics',
      items: [
        'extend-euclid',
        'catalan',
        'xor-basis',
        'fracturing-search',
        'game-theory',
        'multiplicative',
        'matroid-isect',
        'interactive',
        'vectorization',
      ],
    },
  ],
};

export default MODULE_ORDERING;
export const SECTIONS: SectionID[] = Object.keys(
  MODULE_ORDERING
) as SectionID[];
export const SECTION_LABELS: { [key in SectionID]: string } = {
  general: 'Предговор',
  beginner: 'Начинаещ 7-8 клас',
  intermediate: 'Междинен 9-10 клас',
  advanced: 'Напреднал 11-12 клас',
  special: 'Специален',
  beyond: 'Отвъд',
} as const;
export const SECTION_SEO_DESCRIPTION: { [key in SectionID]: string } = {
  general:
    'Обща информация за какво представлява този сайт, как да го ползвате и какво са олимпиадите и състезанията по природни науки.',
  beginner:
    'Секция, която включва подходящ материал на ниво 7-8 клас, нужен при подготовката за олимпиадите и състезания по природни науки.',
  intermediate:
    'Секция, която включва подходящ материал на ниво 9-10 клас, нужен при подготовката за олимпиадите и състезания по природни науки.',
  advanced:
    'Секция, която включва подходящ материал на ниво 11-12 клас, нужен при подготовката за олимпиадите и състезания по природни науки.',
  special:
    'Секция, която включва допълнителен материал на по-високо ниво, нужен при подготовката за Международните олимпиади по природни науки.',
  beyond:
    'Секция, която включва материал отвъд учебния план в училищата, както и отвъд стандарта на олимпиадите, но който задълбочава знанията на състезателите, особено на тези с напреднали интереси. Включва "университетски" теми и всичко на високо ниво, неподходящо за останалите секции.',
};
export const SECTION_SEO_TITLES: { [key in SectionID]: string } = {
  general: 'Предговор',
  beginner: 'Начинаещ 7-8 клас',
  intermediate: 'Междинен 9-10 клас',
  advanced: 'Напреднал 11-12 клас',
  special: 'Специален, международния кръг',
  beyond: 'Отвъд, по-надълбоко',
};

const moduleIDToSectionMap: { [key: string]: SectionID } = {};

SECTIONS.forEach(section => {
  MODULE_ORDERING[section].forEach(category => {
    category.items.forEach(moduleID => {
      moduleIDToSectionMap[moduleID] = section;
    });
  });
});

export { moduleIDToSectionMap, moduleIDToURLMap };

const moduleIDToURLMap: { [key: string]: string } = {};

SECTIONS.forEach(section => {
  MODULE_ORDERING[section].forEach(category => {
    category.items.forEach(moduleID => {
      moduleIDToURLMap[moduleID] = `/${section}/${moduleID}`;
    });
  });
});
