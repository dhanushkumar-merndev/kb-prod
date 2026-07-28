export function formatInrAmount(value: number): string {
  return `INR ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)}`;
}

export function wrapInvoiceText(value: string, maximumCharacters: number): string[] {
  const normalized = value.replace(/\s+/gu, " ").trim();

  if (!normalized) {
    return [];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of normalized.split(" ")) {
    if (word.length > maximumCharacters) {
      if (current) {
        lines.push(current);
        current = "";
      }

      for (let index = 0; index < word.length; index += maximumCharacters) {
        lines.push(word.slice(index, index + maximumCharacters));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maximumCharacters) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}
