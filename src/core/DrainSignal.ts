export class DrainSignal {
  private draining = false;

  activate(): void {
    this.draining = true;
  }

  reset(): void {
    this.draining = false;
  }

  isDraining(): boolean {
    return this.draining;
  }
}
