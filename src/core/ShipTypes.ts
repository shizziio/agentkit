export interface StoryWithEpic {
  id: number;
  storyKey: string;
  title: string;
  status: string;
  epicId: number;
  epicKey: string;
  epicTitle: string;
  hasExistingTasks: boolean;
  dependsOn: string[] | null;
}

export interface WaitingStory {
  storyKey: string;
  unmetDeps: string[];
}

export interface ShipResult {
  shippedCount: number;
  waitingCount: number;
  waitingStories: WaitingStory[];
}
