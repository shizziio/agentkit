export type MenuLevel = 'main' | 'epic-story-mgmt' | 'task-mgmt' | 'config' | 'action';

export interface MenuItem {
  label: string;
  action: string;
  hotkey?: string;
  isSubmenu?: boolean;
}

export interface MenuState {
  stack: MenuLevel[];
  cursor: number;
}
