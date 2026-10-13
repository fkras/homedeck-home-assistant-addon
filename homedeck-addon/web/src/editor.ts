/**
 * The YAML editor, and the single path by which the configuration changes.
 *
 * Its model is the source of truth. The visual editor never writes the store
 * directly: it computes new text and applies it here as an ordinary edit, so
 * typing and clicking share one undo history and the YAML view is always
 * exactly what will be saved.
 */
// The editor's core and YAML only. 'monaco-editor' itself also brings every
// other language Monaco ships - some 80 extra files in the build - and only
// YAML is ever edited here.
import 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { configureMonacoYaml } from 'monaco-yaml';

import YamlWorker from './lib/workaround-yaml.worker?worker';
import { getState, setState, type Problem } from './store';
import { minimalEdit, parseConfig, stringifyConfig, type Document, type Path } from './yaml/document';

window.MonacoEnvironment = {
    getWorker(_, label) {
        switch (label) {
            case 'editorWorkerService':
                return new EditorWorker();
            case 'yaml':
                return new YamlWorker();
            default:
                throw new Error(`Unknown label ${label}`);
        }
    },
};

const MODEL_URI = monaco.Uri.parse('file:///homedeck.yaml');

const monacoYaml = configureMonacoYaml(monaco, {
    enableSchemaRequest: true,
    schemas: [],
});

const model = monaco.editor.createModel('', 'yaml', MODEL_URI);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

model.onDidChangeContent(() => {
    setState({ text: model.getValue() });
});

monaco.editor.onDidChangeMarkers(uris => {
    if (!uris.some(uri => uri.toString() === MODEL_URI.toString())) {
        return;
    }

    const problems: Problem[] = monaco.editor.getModelMarkers({ resource: MODEL_URI })
        .filter(m => m.severity >= monaco.MarkerSeverity.Warning)
        .map(m => ({
            message: m.message,
            line: m.startLineNumber,
            column: m.startColumn,
            severity: m.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
        }));

    setState({ problems });
});

export function mountEditor(container: HTMLElement) {
    if (editor) {
        return;
    }

    editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        theme: 'vs-dark',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        quickSuggestions: {
            other: true,
            comments: false,
            strings: true,
        },

        // Paste YAML verbatim. Monaco re-indents pasted lines by default,
        // which adds indentation to text that already has it - in YAML that
        // silently changes the nesting and breaks the document.
        autoIndent: 'none',
        formatOnPaste: false,
        formatOnType: false,

        // YAML is space-indented; a stray tab is a parse error
        insertSpaces: true,
        tabSize: 2,
        detectIndentation: false,
        readOnly: getState().phase !== 'ready',
    });
}

export function setReadOnly(readOnly: boolean) {
    editor?.updateOptions({ readOnly });
}

/** Replace the whole text, e.g. after loading a device. Clears undo history. */
export function loadText(text: string) {
    model.setValue(text);
}

export function setSchemaUrl(url: string | null) {
    monacoYaml.update({
        schemas: url ? [{ fileMatch: ['**/homedeck.*'], uri: url }] : [],
    });
}

/** Apply new text as a single undoable edit that touches only what changed. */
export function applyText(text: string) {
    const edit = minimalEdit(model.getValue(), text);
    if (!edit) {
        return;
    }

    const start = model.getPositionAt(edit.start);
    const end = model.getPositionAt(edit.end);
    const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);

    model.pushStackElement();
    model.pushEditOperations([], [{ range, text: edit.text, forceMoveMarkers: true }], () => null);
    model.pushStackElement();
}

export type EditResult = { ok: true } | { ok: false; error: string };

/**
 * Change the configuration through its YAML document. `change` gets a fresh
 * parse of the current text; whatever it does is written back.
 */
export function editConfig(change: (doc: Document) => void): EditResult {
    const current = model.getValue();
    const parsed = parseConfig(current);
    if (!parsed.ok) {
        return { ok: false, error: `Fix the YAML first: ${parsed.error}` };
    }

    try {
        change(parsed.doc);
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }

    applyText(stringifyConfig(parsed.doc, current));
    return { ok: true };
}

// The text model's own undo stack. Not in Monaco's public typings, but it's
// what the editor's undo command uses, and it works while the editor is hidden.
type UndoableModel = { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean };
const history = model as unknown as UndoableModel;

export function undo() {
    history.undo();
}

export function redo() {
    history.redo();
}

export function canUndo() {
    return history.canUndo();
}

export function canRedo() {
    return history.canRedo();
}

/** Select the lines of the node at `path` and scroll to them. */
export function revealPath(path: Path) {
    if (!editor) {
        return;
    }

    const parsed = parseConfig(model.getValue());
    if (!parsed.ok) {
        return;
    }

    const node = parsed.doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    if (!node?.range) {
        return;
    }

    const start = model.getPositionAt(node.range[0]);
    const end = model.getPositionAt(node.range[1]);
    const range = new monaco.Range(start.lineNumber, 1, Math.max(start.lineNumber, end.column === 1 ? end.lineNumber - 1 : end.lineNumber), Number.MAX_SAFE_INTEGER);

    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    editor.focus();
}

export function revealLine(line: number, column = 1) {
    editor?.setPosition({ lineNumber: line, column });
    editor?.revealLineInCenter(line);
    editor?.focus();
}

export function layoutEditor() {
    editor?.layout();
}
