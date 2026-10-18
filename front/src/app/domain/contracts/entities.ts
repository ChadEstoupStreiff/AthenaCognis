/** Project as returned by the backend (`todo` is a JSON string on list endpoints). */
export interface BackendProject {
  readonly name: string;
  readonly description: string | null;
  readonly color: string;
  readonly notes: string | null;
  readonly todo: string | null;
}

/** One project TODO item (backend keys are capitalized). */
export interface BackendTodoItem {
  readonly Done: boolean;
  readonly Task: string;
}

/** Project TODO item as used by the SPA. */
export interface TodoItem {
  readonly done: boolean;
  readonly task: string;
}

/** Project as used by the SPA. */
export interface Project {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly notes: string;
  readonly todo: readonly TodoItem[];
}

/** Tag. */
export interface Tag {
  readonly name: string;
  readonly color: string;
}

/** Contact summary (list endpoints). */
export interface ContactSummary {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly role: string | null;
  readonly description?: string | null;
  readonly notes?: string | null;
}

/** Contact with its links (`GET /contacts/{id}`). */
export interface ContactDetail extends ContactSummary {
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly files: readonly string[];
}

/** Body of `POST/PUT /contacts` (PUT replaces links too). */
export interface ContactUpsert {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly role: string | null;
  readonly description: string | null;
  readonly notes: string;
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly files: readonly string[];
}

/** Project name length limit (DB column). */
export const PROJECT_NAME_MAX_LENGTH = 50;

/** Tag name length limit (DB column). */
export const TAG_NAME_MAX_LENGTH = 20;

/** Create/edit body of a project. */
export interface ProjectInput {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

/** Create/edit body of a tag. */
export interface TagInput {
  readonly name: string;
  readonly color: string;
}
