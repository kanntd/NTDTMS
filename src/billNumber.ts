export function billYear(date = new Date()) {
  return String(date.getFullYear()).slice(-2);
}

export function billNumberPrefix(documentCode: string, date = new Date()) {
  return `${documentCode.trim().toUpperCase()}${billYear(date)}`;
}

export function nextLocalBillNumber(
  documentCode: string,
  existingNumbers: string[],
  date = new Date(),
) {
  const prefix = billNumberPrefix(documentCode, date);
  const maximum = existingNumbers.reduce((current, number) => {
    if (!number.startsWith(prefix)) return current;
    const sequence = number.slice(prefix.length);
    return /^\d{6}$/.test(sequence)
      ? Math.max(current, Number(sequence))
      : current;
  }, 0);
  return `${prefix}${String(maximum + 1).padStart(6, "0")}`;
}
