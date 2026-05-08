export interface Note {
  id: string
  content: string
  x: number
  y: number
  color: string
  width: number
  height: number
  fontSize?: number
  dueDate?: string
  hidden?: boolean
  pinned?: boolean
  createdAt: string
}
