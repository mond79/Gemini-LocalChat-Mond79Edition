// [CoreDNA] This module exclusively manages the lifecycle of typing animations.
import { appState } from '../state/AppState.js';
import * as Session from '../state/SessionManager.js';
import { createDOMElement } from '../../components/common.js';
import { animate as animateTypewriter } from '../utils/typewriter.js';
import { applySyntaxHighlighting } from '../utils/highlighter.js';
import { renderMathInElement, renderMathInString } from '../utils/MathRenderer.js';
import * as CodeBlock from '../components/CodeBlock.js';
import { create as createMessageElement } from '../components/Message.js';

const activeAnimations = new Map(); // sessionId -> { controller }

// [HCA] A reusable function to dispatch a system-wide event.
function dispatchCompletionEvent(sessionId) {
    document.dispatchEvent(new CustomEvent('animation-complete', {
        detail: { sessionId }
    }));
}

function buildAnimationPlan(sourceNode, plan = []) {
    for (const child of Array.from(sourceNode.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName === 'PRE') {
                plan.push({ type: 'atomic_block', node: child });
                continue;
            }
            plan.push({ type: 'enter', node: child });
            buildAnimationPlan(child, plan);
            plan.push({ type: 'leave', node: child });
        } else if (child.nodeType === Node.TEXT_NODE) {
            const text = child.nodeValue;
            const words = text.match(/\S+\s*|\s+/g) || [];
            for (const word of words) {
                plan.push({ type: 'word', value: word });
            }
        }
    }
    return plan;
}

export async function start(sessionId, message, textPartDiv) {
    if (isAnimating(sessionId) || !message || !message.receivedAt) return;

    const controller = new AbortController();
    activeAnimations.set(sessionId, { controller });

    const isCancelled = () => controller.signal.aborted;

    try {
        const textPart = message.parts.find(p => p.type === 'text');
        const fullText = textPart ? textPart.text : '';
        const rawHtml = window.marked.parse(fullText);
        const sanitizedHtml = window.DOMPurify.sanitize(rawHtml);
        const mathRenderedHtml = renderMathInString(sanitizedHtml);
        const finalHtml = CodeBlock.enhance(mathRenderedHtml);

        const sourceNode = createDOMElement('div');
        sourceNode.innerHTML = finalHtml;
        applySyntaxHighlighting(sourceNode);
        const animationPlan = buildAnimationPlan(sourceNode);

        textPartDiv.innerHTML = '';
        await animateTypewriter(animationPlan, textPartDiv, {
            typingSpeed: appState.settings.typingSpeed,
            onCharacterTyped: () => {
                const chatBox = document.getElementById('chat-box');
                if (!chatBox) return;
                if (appState.activeSessionId === sessionId) {
                    const wasAtBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 50;
                    if (wasAtBottom) chatBox.scrollTop = chatBox.scrollHeight;
                }
            },
            onNodeCompleted: (node) => { renderMathInElement(node); },
            isCancelled: isCancelled,
        });

        if (isCancelled()) {
            console.log(`[AnimationManager] Animation for session ${sessionId} was cancelled.`);
            textPartDiv.innerHTML = finalHtml;
            applySyntaxHighlighting(textPartDiv);
            renderMathInElement(textPartDiv);
            return; // The finally block will handle cleanup
        }

        // --- [THE FIX] State-First, Render-After Principle ---
        const session = appState.sessions[sessionId];
        if (!session) return;

        // 1. Update the message DATA model: animation is complete.
        Session.markTypingAsComplete(appState, sessionId, message.id);

        // 2. Update the application STATE model: loading is complete.
        delete appState.loadingStates[sessionId];

        // 3. Now that the state is correct, re-render the final message UI.
        // This ensures create() sees isLoading as false and renders enabled buttons.
        const messageWrapper = textPartDiv.closest('.message');
        if (messageWrapper && messageWrapper.parentElement) {
            const refreshedMessage = appState.sessions[sessionId]?.history.find(m => m.id === message.id);
            if (refreshedMessage) {
                const newMessageEl = createMessageElement(refreshedMessage, session);
                messageWrapper.parentNode.replaceChild(newMessageEl, messageWrapper);
                applySyntaxHighlighting(newMessageEl);
                renderMathInElement(newMessageEl);
            }
        }
    } catch (error) {
        console.error(`[AnimationManager] Error during animation for session ${sessionId}:`, error);
    } finally {
        activeAnimations.delete(sessionId);
        // 4. Dispatch the completion event for OTHER components (sidebar, input bar) to sync up.
        dispatchCompletionEvent(sessionId);
    }
}

export function stop(sessionId) {
    const animation = activeAnimations.get(sessionId);
    if (animation) {
        animation.controller.abort();
        // The start() function's finally block will handle cleanup and event dispatching.
    }
}

export function isAnimating(sessionId) {
    return activeAnimations.has(sessionId);
}