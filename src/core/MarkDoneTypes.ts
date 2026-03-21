export interface MarkDoneResult {
  storiesMarked: number;
  epicsMarked: number;
}

export interface MarkableStory {
  id: number;
  storyKey: string;
  title: string;
  status: string;
  epicId: number;
  epicKey: string;
  epicTitle: string;
}

export interface EpicMarkInfo {
  id: number;
  epicKey: string;
  title: string;
  totalStories: number;
  doneStories: number;
  allDone: boolean;
}

export interface IMarkDoneService {
  markStoriesDone(storyIds: number[]): MarkDoneResult;
  markEpicDone(epicId: number): MarkDoneResult;
  getMarkableStories(projectId: number): MarkableStory[];
  getMarkableEpics(projectId: number): EpicMarkInfo[];
  startListening(): void;
}
