export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEquals<T>(
  actual: T,
  expected: T,
  message = "Values are not equal",
): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${
        JSON.stringify(actual)
      }`,
    );
  }
}

export function assertDeepEquals(
  actual: unknown,
  expected: unknown,
  message = "Values are not deeply equal",
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`,
    );
  }
}

export function assertThrows(
  fn: () => unknown,
  expectedMessage: string,
): void {
  try {
    fn();
  } catch (error: unknown) {
    if (!(error instanceof Error)) {
      throw new Error(`Expected Error instance, received: ${String(error)}`);
    }

    if (!error.message.includes(expectedMessage)) {
      throw new Error(
        `Expected error message to include '${expectedMessage}', received '${error.message}'`,
      );
    }

    return;
  }

  throw new Error(
    `Expected function to throw an error containing '${expectedMessage}'`,
  );
}
