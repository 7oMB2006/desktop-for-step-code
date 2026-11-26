type TerminalSanitizerState = "text" | "escape" | "escape-intermediate" | "csi" | "string" | "string-escape";

/**
 * Removes terminal controls before an excerpt is displayed or submitted.
 * String controls (OSC/DCS/PM/APC) may span lines and are discarded through
 * their terminator; an unterminated control is discarded through EOF.
 */
export function sanitizeTerminalText(value: string): string {
	let state: TerminalSanitizerState = "text";
	let output = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		switch (state) {
			case "text":
				if (character === "\n") {
					output += character;
				} else if (character === "\t") {
					output += " ";
				} else if (codePoint === 0x1b) {
					state = "escape";
				} else if (codePoint === 0x9b) {
					state = "csi";
				} else if (codePoint === 0x90 || codePoint === 0x9d || codePoint === 0x9e || codePoint === 0x9f) {
					state = "string";
				} else if (codePoint >= 0x20 && codePoint !== 0x7f && !(codePoint >= 0x80 && codePoint <= 0x9f)) {
					output += character;
				}
				break;
			case "escape":
				if (character === "[") {
					state = "csi";
				} else if (character === "]" || character === "P" || character === "^" || character === "_") {
					state = "string";
				} else if (codePoint >= 0x20 && codePoint <= 0x2f) {
					state = "escape-intermediate";
				} else if (codePoint === 0x1b) {
					state = "escape";
				} else if (character === "\n") {
					output += character;
					state = "text";
				} else {
					state = "text";
				}
				break;
			case "escape-intermediate":
				if (codePoint === 0x1b) {
					state = "escape";
				} else if (character === "\n") {
					output += character;
					state = "text";
				} else if (codePoint >= 0x30 && codePoint <= 0x7e) {
					state = "text";
				}
				break;
			case "csi":
				if (codePoint === 0x1b) {
					state = "escape";
				} else if (codePoint >= 0x40 && codePoint <= 0x7e) {
					state = "text";
				}
				break;
			case "string":
				if (codePoint === 0x07 || codePoint === 0x9c) {
					state = "text";
				} else if (codePoint === 0x1b) {
					state = "string-escape";
				}
				break;
			case "string-escape":
				if (character === "\\" || codePoint === 0x9c) {
					state = "text";
				} else if (codePoint !== 0x1b) {
					state = "string";
				}
				break;
		}
	}
	return output;
}
