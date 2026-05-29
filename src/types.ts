export interface Contact {
  [key: string]: any;
}

export interface Group {
  id: string;
  name: string;
  count: number;
}

export interface Settings {
  wahaUrl: string;
  apiKey: string;
}

export interface WahaSession {
  name: string;
  status: string;
  me?: any;
  config?: any;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface DaySchedule {
  dayOfWeek: number;
  slots: TimeSlot[];
}

export interface Campaign {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  sessions: string[];
  startTime: string;
  endTime: string;
  schedules?: DaySchedule[];
  intervalMin: number;
  intervalMax: number;
  distributionMethod: string;
  templates: string[];
  status: string;
  totalContacts: number;
  sent: number;
  failed: number;
  logs: string[];
  createdAt: string;
  nextSendTime?: string;
}
