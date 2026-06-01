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
  label?: string
  hidden?: boolean
  pinned?: boolean
  createdAt: string
}

export interface QuickItem {
  id: string
  label: string
  content: string
  type: 'text' | 'link' | 'file'
  category: string
}
