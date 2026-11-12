export class JobTracker {
  private active = new Set<string>()

  begin(id: string): void {
    this.active.add(id)
  }

  finish(id: string): void {
    this.active.delete(id)
  }

  clear(): void {
    this.active.clear()
  }

  get busy(): boolean {
    return this.active.size > 0
  }
}
