// [HCA] This utility is solely responsible for executing a pre-built animation plan.
import { createDOMElement } from '../../components/common.js';

export async function animate(plan, targetNode, options) {
    if (!plan || !targetNode || !options) return;

    let currentTarget = targetNode;
    const parentStack = [];

    for (const step of plan) {
        if (options.isCancelled && options.isCancelled()) return;

        switch (step.type) {
            case 'enter':
                parentStack.push(currentTarget);
                const newElement = step.node.cloneNode(false);
                currentTarget.appendChild(newElement);
                currentTarget = newElement;
                break;
            case 'leave':
                if (options.onNodeCompleted) options.onNodeCompleted(currentTarget);
                currentTarget = parentStack.pop();
                break;
            case 'word':
                await new Promise(resolve => setTimeout(resolve, options.typingSpeed * 0.75));
                const wordChunk = step.value;
                const match = wordChunk.match(/^(\S+)(\s*)$/);
                if (match) {
                    const wordPart = match[1];
                    const spacePart = match[2];
                    const wordSpan = createDOMElement('span', { class: 'animated-char' }, wordPart);
                    currentTarget.appendChild(wordSpan);
                    if (spacePart) currentTarget.appendChild(document.createTextNode(spacePart));
                } else {
                    currentTarget.appendChild(document.createTextNode(wordChunk));
                }
                if (options.onCharacterTyped) options.onCharacterTyped();
                break;
            case 'atomic_block':
                 const clonedBlock = step.node.cloneNode(true);
                 currentTarget.appendChild(clonedBlock);
                 if (options.onNodeCompleted) options.onNodeCompleted(clonedBlock);
                 await new Promise(resolve => setTimeout(resolve, options.typingSpeed * 3));
                 break;
        }
    }
}