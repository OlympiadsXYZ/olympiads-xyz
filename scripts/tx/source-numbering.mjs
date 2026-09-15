// A complete source can be an individually archived question numbered 2, 3, etc.
// Use explicit catalogue labels only when the inventory covers every question.
export function expectedProblemNumbers(manifest, count) {
  const listed = manifest?.meta?.listed;
  if (listed?.problems === count && Array.isArray(listed.titles) && listed.titles.length === count) {
    const numbers = listed.titles.map(title => {
      const match = typeof title === 'string' && /^([1-9]\d*)(?:\s*·|\s*$)/u.exec(title);
      return match ? Number(match[1]) : null;
    });
    if (numbers.every(Number.isSafeInteger) && new Set(numbers).size === count) return numbers;
  }
  return Array.from({ length: count }, (_, i) => i + 1);
}
