const LEADING_ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

export function tokenizeBuildCommand(command: string): string[] {
  const tokens: string[] = [];
  let currentToken = "";
  let activeQuote: "'" | '"' | undefined;
  let isEscaped = false;

  for (const character of command) {
    if (isEscaped) {
      currentToken += character;
      isEscaped = false;
      continue;
    }

    if (!activeQuote && character === "\\") {
      isEscaped = true;
      continue;
    }

    if (character === "'" || character === '"') {
      if (activeQuote === character) {
        activeQuote = undefined;
        continue;
      }

      if (!activeQuote) {
        activeQuote = character;
        continue;
      }
    }

    if (!activeQuote && /\s/.test(character)) {
      if (currentToken !== "") {
        tokens.push(currentToken);
        currentToken = "";
      }
      continue;
    }

    currentToken += character;
  }

  if (isEscaped) {
    currentToken += "\\";
  }

  if (currentToken !== "") {
    tokens.push(currentToken);
  }

  return tokens;
}

// Best effort only: build-command is arbitrary shell text, so we extract just
// the first executable-like token and skip leading KEY=value assignments.
export function resolveBuildCommandExecutable(
  command: string,
): string | undefined {
  const tokens = tokenizeBuildCommand(command);

  for (const token of tokens) {
    if (LEADING_ENV_ASSIGNMENT_PATTERN.test(token)) {
      continue;
    }

    return token;
  }

  return undefined;
}

export function firstNonEmptyLine(value: string): string | undefined {
  for (const line of value.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine !== "") {
      return trimmedLine;
    }
  }

  return undefined;
}
