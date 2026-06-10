import { TestingNav } from './TestingNav'

export default function TestingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <TestingNav />
      {children}
    </div>
  )
}
