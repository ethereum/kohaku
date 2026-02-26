async function loadFalcon() {
    const scriptUrl = new URL('./falcon.js', import.meta.url).href;
    const res = await fetch(scriptUrl);
    const src = await res.text();
    const fn = new Function(src + '\nreturn Module;');
    return fn();
}
export default await loadFalcon();