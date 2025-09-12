export const binarySearchForUpperBoundIndex = <T>(array: T[], pred: (a: T) => boolean): number => {
  let l = 0;
  let r = array.length;
  while (l < r) {
    const mid = l + ((r - l) >> 1);
    const item = array[mid];
    if (pred(item)) {
      l = mid + 1;
    } else {
      r = mid;
    }
  }
  return l - 1;
};

export const binarySearchForString = <T>(
  array: T[],
  str: string,
  getString: (a: T) => string,
): number => {
  let startIndex = 0;
  let stopIndex = array.length - 1;
  let middle = Math.floor((stopIndex + startIndex) / 2);
  while (getString(array[middle]) !== str && startIndex < stopIndex) {
    if (str < getString(array[middle])) {
      stopIndex = middle - 1;
    } else if (str > getString(array[middle])) {
      startIndex = middle + 1;
    }
    middle = Math.floor((stopIndex + startIndex) / 2);
  }
  return getString(array[middle]) !== str ? -1 : middle;
};
