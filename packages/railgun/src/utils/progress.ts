export const progressBar = (start: number, current: number, end: number) => {
  const progress = Math.ceil(((current - start) / (end - start)) * 100);
  const progressBar =
    "[" +
    "=".repeat(progress) +
    ">" +
    "-".repeat(Math.max(100 - 1 - progress, 0)) +
    "] #" +
    current +
    " -> #" +
    end +
    " (" +
    (current - start) +
    "/" +
    (end - start) +
    ")";

  return progressBar;
};
