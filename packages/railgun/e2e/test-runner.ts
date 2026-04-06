import { JsSigner } from '../src/index';

const el = document.getElementById('output')!;
try {
    const signer = JsSigner.random(1n);
    el.textContent = JSON.stringify({ passed: true, address: signer.address }, null, 2);
    el.style.color = 'green';
} catch (e) {
    el.textContent = JSON.stringify({ passed: false, error: String(e) }, null, 2);
    el.style.color = 'red';
}

export { };