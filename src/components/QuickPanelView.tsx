import { useState } from 'react'
import type { QuickItem } from '../types'

interface Props {
  items: QuickItem[]
}

export default function QuickPanelView({ items }: Props) {
  const [copied, setCopied] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <div className="notes-list">
        <p className="empty-msg">Sin accesos rápidos.{'\n'}Añade ítems desde el escritorio.</p>
      </div>
    )
  }

  const categories = [...new Set(items.map(i => i.category))]

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // clipboard API not available
    }
  }

  const handleOpen = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="quick-list">
      {categories.map(cat => (
        <div key={cat} className="quick-category">
          <div className="quick-cat-header">{cat}</div>
          {items.filter(i => i.category === cat).map(item => (
            <div key={item.id} className="quick-item">
              <span className="quick-item-icon">
                {item.type === 'link' ? '🔗' : item.type === 'file' ? '📁' : '📝'}
              </span>
              <span className="quick-item-label" title={item.content}>{item.label}</span>
              {item.type === 'link' ? (
                <button className="quick-action-btn" onClick={() => handleOpen(item.content)}>Abrir</button>
              ) : (
                <button
                  className={`quick-action-btn ${copied === item.id ? 'copied' : ''}`}
                  onClick={() => handleCopy(item.id, item.content)}
                >
                  {copied === item.id ? '✓' : 'Copiar'}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
