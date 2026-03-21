export function greet(name: string): string {
  return name === '' ? 'Hello, stranger!' : `Hello, ${name}!`;
}

export function farewell(name: string): string {
  return name === '' ? 'Goodbye, stranger!' : `Goodbye, ${name}!`;
}
