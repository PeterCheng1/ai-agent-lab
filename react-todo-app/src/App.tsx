import { useState, useEffect, useRef } from 'react';
import './App.css';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

type FilterType = 'all' | 'active' | 'completed';

function App() {
  const [todos, setTodos] = useState<Todo[]>(() => {
    const saved = localStorage.getItem('react-todo-app-data');
    return saved ? JSON.parse(saved) : [];
  });
  const [filter, setFilter] = useState<FilterType>('all');
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('react-todo-app-data', JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const filteredTodos = todos.filter((todo) => {
    if (filter === 'active') return !todo.completed;
    if (filter === 'completed') return todo.completed;
    return true;
  });

  const stats = {
    total: todos.length,
    active: todos.filter((t) => !t.completed).length,
    completed: todos.filter((t) => t.completed).length,
  };

  const addTodo = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const newTodo: Todo = {
      id: Date.now().toString(),
      text: trimmed,
      completed: false,
    };
    setTodos((prev) => [newTodo, ...prev]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo();
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && editingId) {
      setTodos((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, text: trimmed } : t))
      );
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  const removeTodo = (id: string) => {
    setRemovingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setTodos((prev) => prev.filter((t) => t.id !== id));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  };

  const clearCompleted = () => {
    const completedIds = todos.filter((t) => t.completed).map((t) => t.id);
    completedIds.forEach((id) => setRemovingIds((prev) => new Set(prev).add(id)));
    setTimeout(() => {
      setTodos((prev) => prev.filter((t) => !t.completed));
      setRemovingIds(new Set());
    }, 300);
  };

  return (
    <div className="app">
      <div className="todo-container">
        <header className="todo-header">
          <h1>
            <span className="header-icon">✅</span>
            TodoList
          </h1>
          <p className="subtitle">保持专注，完成每一项任务</p>
        </header>

        {/* 输入区域 */}
        <div className="input-section">
          <input
            ref={inputRef}
            type="text"
            className="todo-input"
            placeholder="添加新的任务..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="add-btn" onClick={addTodo}>
            <span className="add-icon">＋</span>
          </button>
        </div>

        {/* 统计与筛选 */}
        <div className="filter-stats-bar">
          <div className="stats">
            <span className="stat-item stat-total">
              全部 <strong>{stats.total}</strong>
            </span>
            <span className="stat-item stat-active">
              进行中 <strong>{stats.active}</strong>
            </span>
            <span className="stat-item stat-completed">
              已完成 <strong>{stats.completed}</strong>
            </span>
          </div>
          <div className="filters">
            {(['all', 'active', 'completed'] as FilterType[]).map((f) => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '全部' : f === 'active' ? '进行中' : '已完成'}
              </button>
            ))}
          </div>
        </div>

        {/* 列表 */}
        <ul className="todo-list">
          {filteredTodos.length === 0 ? (
            <li className="empty-state">
              <span className="empty-icon">📝</span>
              <p>暂无任务</p>
              <small>添加你的第一个任务吧</small>
            </li>
          ) : (
            filteredTodos.map((todo, index) => (
              <li
                key={todo.id}
                className={`todo-item ${todo.completed ? 'completed' : ''} ${
                  removingIds.has(todo.id) ? 'removing' : ''
                }`}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <button
                  className={`check-btn ${todo.completed ? 'checked' : ''}`}
                  onClick={() => toggleTodo(todo.id)}
                  aria-label={todo.completed ? '标记未完成' : '标记完成'}
                >
                  {todo.completed && '✓'}
                </button>

                {editingId === todo.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    className="edit-input"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={saveEdit}
                  />
                ) : (
                  <span
                    className="todo-text"
                    onDoubleClick={() => startEdit(todo)}
                    title="双击编辑"
                  >
                    {todo.text}
                  </span>
                )}

                <div className="todo-actions">
                  <button
                    className="action-btn edit-btn"
                    onClick={() => startEdit(todo)}
                    title="编辑"
                  >
                    ✎
                  </button>
                  <button
                    className="action-btn delete-btn"
                    onClick={() => removeTodo(todo.id)}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>

        {/* 底部 */}
        {todos.length > 0 && (
          <div className="todo-footer">
            <span className="footer-info">
              共 {stats.total} 项任务，{stats.active} 项未完成
            </span>
            {stats.completed > 0 && (
              <button className="clear-btn" onClick={clearCompleted}>
                清除已完成
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="app-footer">
        <p>React TodoList — 数据自动保存到本地</p>
      </footer>
    </div>
  );
}

export default App;
