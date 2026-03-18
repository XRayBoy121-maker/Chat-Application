import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Send, 
  Image as ImageIcon, 
  Video, 
  Mic, 
  Smile, 
  User as UserIcon, 
  LogOut, 
  Search,
  Paperclip,
  MoreVertical,
  X,
  Play,
  Pause
} from 'lucide-react';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';
import { motion, AnimatePresence } from 'framer-motion';

// Types
interface User {
  id: string;
  name: string;
  bio: string;
  avatar: string;
  status?: 'online' | 'offline';
}

interface Message {
  from: string;
  to: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'sticker';
  timestamp: number;
  mediaUrl?: string;
}

const PREDEFINED_AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aria",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Jack",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Luna",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Milo",
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userIdInput, setUserIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [error, setError] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activeChat, setActiveChat] = useState<string>('group'); // 'group' or userId
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({}); // chatTarget -> Set of userIds typing
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [showProfileModal, setShowProfileModal] = useState<User | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editBio, setEditBio] = useState('');
  const [editAvatar, setEditAvatar] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (user) {
      const newSocket = io();
      setSocket(newSocket);
      newSocket.emit('register', user.id);

      newSocket.on('receive_message', (msg: Message) => {
        setMessages(prev => [...prev, msg]);
        // Clear typing indicator when message received
        setTypingUsers(prev => {
          const chatTarget = msg.to === 'group' ? 'group' : msg.from;
          const newSet = new Set(prev[chatTarget] || []);
          newSet.delete(msg.from);
          return { ...prev, [chatTarget]: newSet };
        });
      });

      newSocket.on('user_typing', ({ from, to, isTyping }) => {
        setTypingUsers(prev => {
          const chatTarget = to === 'group' ? 'group' : from;
          const newSet = new Set(prev[chatTarget] || []);
          if (isTyping) newSet.add(from);
          else newSet.delete(from);
          return { ...prev, [chatTarget]: newSet };
        });
      });

      newSocket.on('user_status', ({ userId, status }) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, status } : u));
      });

      fetchUsers();

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChat]);

  const fetchUsers = async () => {
    const res = await fetch('/api/users');
    const data = await res.json();
    setUsers(data);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userIdInput, password: passwordInput }),
    });
    const data = await res.json();
    if (data.success) {
      setUser(data.user);
      setEditBio(data.user.bio);
      setEditAvatar(data.user.avatar);
    } else {
      setError(data.message);
    }
  };

  const handleTyping = () => {
    if (!socket || !user) return;

    socket.emit('typing', { from: user.id, to: activeChat, isTyping: true });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { from: user.id, to: activeChat, isTyping: false });
    }, 2000);
  };

  const handleSendMessage = (type: Message['type'] = 'text', mediaUrl?: string) => {
    if (!inputText.trim() && !mediaUrl) return;
    if (!socket || !user) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      socket.emit('typing', { from: user.id, to: activeChat, isTyping: false });
    }

    const newMessage: Message = {
      from: user.id,
      to: activeChat,
      content: inputText,
      type,
      timestamp: Date.now(),
      mediaUrl,
    };

    socket.emit('send_message', newMessage);
    setMessages(prev => [...prev, newMessage]);
    setInputText('');
    setShowEmojiPicker(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    let type: Message['type'] = 'image';
    if (file.type.startsWith('video/')) type = 'video';
    if (file.type.startsWith('audio/')) type = 'audio';

    handleSendMessage(type, data.url);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);
      setAudioChunks([]);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          setAudioChunks(prev => [...prev, e.data]);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        handleSendMessage('audio', data.url);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setInputText(prev => prev + emojiData.emoji);
  };

  const handleUpdateProfile = async () => {
    if (!user) return;
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, bio: editBio, avatar: editAvatar }),
    });
    const data = await res.json();
    if (data.success) {
      setUser({ ...user, bio: editBio, avatar: editAvatar });
      setIsEditingProfile(false);
      fetchUsers();
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    setEditAvatar(data.url);
  };

  const STICKERS = [
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.gif",
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f60d/512.gif",
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f929/512.gif",
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/512.gif",
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.gif",
    "https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/512.gif",
  ];

  const [showStickers, setShowStickers] = useState(false);

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl"
        >
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">Let's Connect</h1>
            <p className="text-neutral-400">Sign in to start chatting</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">User ID</label>
              <input
                type="text"
                value={userIdInput}
                onChange={(e) => setUserIdInput(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                placeholder="Enter your user ID"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
            >
              Sign In
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-neutral-800 text-center">
            <p className="text-xs text-neutral-500">Group Project Members Only</p>
          </div>
        </motion.div>
      </div>
    );
  }

  const filteredMessages = messages.filter(m => {
    if (activeChat === 'group') return m.to === 'group';
    return (m.from === user.id && m.to === activeChat) || (m.from === activeChat && m.to === user.id);
  });

  return (
    <div className="h-screen bg-neutral-950 flex overflow-hidden text-neutral-200 font-sans">
      {/* Sidebar */}
      <div className="w-80 border-r border-neutral-800 flex flex-col bg-neutral-900/50">
        <div className="p-6 border-bottom border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Let's Connect</h2>
          <button 
            onClick={() => setUser(null)}
            className="p-2 hover:bg-neutral-800 rounded-full transition-colors text-neutral-400 hover:text-white"
          >
            <LogOut size={20} />
          </button>
        </div>

        <div className="px-6 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
            <input 
              type="text" 
              placeholder="Search chats..." 
              className="w-full bg-neutral-800 border-none rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          <button
            onClick={() => setActiveChat('group')}
            className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all ${activeChat === 'group' ? 'bg-emerald-600/10 text-emerald-400' : 'hover:bg-neutral-800 text-neutral-400'}`}
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">
              G
            </div>
            <div className="text-left">
              <div className="font-semibold text-white">Group Chat</div>
              <div className="text-xs opacity-60">All members</div>
            </div>
          </button>

          <div className="mt-6 px-4 mb-2 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Direct Messages</div>
          
          {users.filter(u => u.id !== user.id).map(u => (
            <button
              key={u.id}
              onClick={() => setActiveChat(u.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all ${activeChat === u.id ? 'bg-emerald-600/10 text-emerald-400' : 'hover:bg-neutral-800 text-neutral-400'}`}
            >
              <div className="relative">
                <img src={u.avatar} alt={u.name} className="w-12 h-12 rounded-2xl object-cover bg-neutral-800" />
                {u.status === 'online' && (
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-neutral-900 rounded-full"></div>
                )}
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-semibold text-white truncate">{u.name}</div>
                <div className="text-xs opacity-60 truncate">{u.bio}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Current User Profile */}
        <div className="p-4 bg-neutral-900 border-t border-neutral-800">
          <button 
            onClick={() => {
              setShowProfileModal(user);
              setIsEditingProfile(true);
            }}
            className="w-full flex items-center gap-3 p-2 hover:bg-neutral-800 rounded-xl transition-all"
          >
            <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-xl object-cover bg-neutral-800" />
            <div className="text-left flex-1">
              <div className="text-sm font-bold text-white">{user.name}</div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider">My Profile</div>
            </div>
            <MoreVertical size={16} className="text-neutral-500" />
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-neutral-950">
        {/* Chat Header */}
        <div className="h-20 border-b border-neutral-800 flex items-center justify-between px-8 bg-neutral-900/30">
          <div className="flex items-center gap-4">
            {activeChat === 'group' ? (
              <>
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">G</div>
                <div>
                  <h3 className="font-bold text-white">Group Chat</h3>
                  <p className="text-xs text-emerald-500">Active now</p>
                </div>
              </>
            ) : (
              <>
                <img 
                  src={users.find(u => u.id === activeChat)?.avatar} 
                  alt="avatar" 
                  className="w-12 h-12 rounded-2xl object-cover bg-neutral-800 cursor-pointer"
                  onClick={() => setShowProfileModal(users.find(u => u.id === activeChat) || null)}
                />
                <div>
                  <h3 className="font-bold text-white cursor-pointer hover:underline" onClick={() => setShowProfileModal(users.find(u => u.id === activeChat) || null)}>
                    {users.find(u => u.id === activeChat)?.name}
                  </h3>
                  <p className="text-xs text-neutral-500">Private Message</p>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-4 text-neutral-400">
            <button className="p-2 hover:bg-neutral-800 rounded-full transition-colors"><Search size={20} /></button>
            <button className="p-2 hover:bg-neutral-800 rounded-full transition-colors"><MoreVertical size={20} /></button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {filteredMessages.map((msg, idx) => {
            const isMe = msg.from === user.id;
            const sender = users.find(u => u.id === msg.from);
            return (
              <motion.div 
                initial={{ opacity: 0, x: isMe ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                key={idx} 
                className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-3`}
              >
                {!isMe && (
                  <img 
                    src={sender?.avatar} 
                    alt="avatar" 
                    className="w-8 h-8 rounded-lg object-cover bg-neutral-800 cursor-pointer" 
                    onClick={() => setShowProfileModal(sender || null)}
                  />
                )}
                <div className={`max-w-[70%] group`}>
                  {!isMe && activeChat === 'group' && (
                    <div 
                      className="text-[10px] font-bold text-neutral-500 mb-1 ml-1 cursor-pointer hover:text-emerald-500 transition-colors"
                      onClick={() => setShowProfileModal(sender || null)}
                    >
                      {sender?.name}
                    </div>
                  )}
                  <div className={`
                    p-4 rounded-3xl shadow-sm
                    ${isMe ? 'bg-emerald-600 text-white rounded-br-none' : 'bg-neutral-900 text-neutral-200 rounded-bl-none'}
                  `}>
                    {msg.type === 'text' && <p className="text-sm leading-relaxed">{msg.content}</p>}
                    {msg.type === 'sticker' && (
                      <img src={msg.mediaUrl} alt="sticker" className="w-24 h-24" />
                    )}
                    {msg.type === 'image' && (
                      <img src={msg.mediaUrl} alt="shared" className="max-w-full rounded-xl mb-2" />
                    )}
                    {msg.type === 'video' && (
                      <video src={msg.mediaUrl} controls className="max-w-full rounded-xl mb-2" />
                    )}
                    {msg.type === 'audio' && (
                      <audio src={msg.mediaUrl} controls className="max-w-full" />
                    )}
                    <div className={`text-[9px] mt-2 opacity-50 ${isMe ? 'text-right' : 'text-left'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
          <div ref={messagesEndRef} />
          
          {/* Typing Indicator */}
          {typingUsers[activeChat] && typingUsers[activeChat].size > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-neutral-500 italic text-xs ml-12"
            >
              <div className="flex gap-1">
                <span className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
              {activeChat === 'group' 
                ? `${Array.from(typingUsers[activeChat]).map(id => users.find(u => u.id === id)?.name.split(' ')[0]).join(', ')} ${typingUsers[activeChat].size > 1 ? 'are' : 'is'} typing...`
                : 'typing...'}
            </motion.div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-6 bg-neutral-900/50 border-t border-neutral-800 relative">
          <AnimatePresence>
            {showEmojiPicker && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full mb-4 left-6 z-50"
              >
                <EmojiPicker onEmojiClick={onEmojiClick} theme={'dark' as any} />
              </motion.div>
            )}
            {showStickers && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full mb-4 left-16 z-50 bg-neutral-900 border border-neutral-800 p-4 rounded-3xl shadow-2xl grid grid-cols-3 gap-4"
              >
                {STICKERS.map((s, i) => (
                  <img 
                    key={i} 
                    src={s} 
                    className="w-16 h-16 cursor-pointer hover:scale-110 transition-transform" 
                    onClick={() => {
                      handleSendMessage('sticker', s);
                      setShowStickers(false);
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-4 max-w-6xl mx-auto">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  setShowEmojiPicker(!showEmojiPicker);
                  setShowStickers(false);
                }}
                className={`p-3 rounded-2xl transition-colors ${showEmojiPicker ? 'bg-emerald-600 text-white' : 'hover:bg-neutral-800 text-neutral-400 hover:text-white'}`}
              >
                <Smile size={22} />
              </button>
              <button 
                onClick={() => {
                  setShowStickers(!showStickers);
                  setShowEmojiPicker(false);
                }}
                className={`p-3 rounded-2xl transition-colors ${showStickers ? 'bg-emerald-600 text-white' : 'hover:bg-neutral-800 text-neutral-400 hover:text-white'}`}
              >
                <ImageIcon size={22} />
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-3 hover:bg-neutral-800 rounded-2xl transition-colors text-neutral-400 hover:text-white"
              >
                <Paperclip size={22} />
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept="image/*,video/*,audio/*"
              />
            </div>

            <div className="flex-1 relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  handleTyping();
                }}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                className="w-full bg-neutral-800 border-none rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-emerald-500/30 transition-all"
              />
            </div>

            <div className="flex items-center gap-2">
              <button 
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`p-4 rounded-2xl transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
              >
                <Mic size={22} />
              </button>
              <button 
                onClick={() => handleSendMessage()}
                className="p-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
              >
                <Send size={22} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-neutral-900 rounded-3xl overflow-hidden border border-neutral-800 shadow-2xl"
            >
              <div className="h-32 bg-emerald-600 relative">
                <button 
                  onClick={() => {
                    setShowProfileModal(null);
                    setIsEditingProfile(false);
                  }}
                  className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="px-8 pb-8 -mt-16 text-center">
                <div className="relative inline-block mb-4">
                  <img 
                    src={isEditingProfile ? editAvatar : showProfileModal.avatar} 
                    alt={showProfileModal.name} 
                    className="w-32 h-32 rounded-3xl border-4 border-neutral-900 object-cover bg-neutral-800 shadow-xl" 
                  />
                  {isEditingProfile && (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap justify-center gap-2">
                        {PREDEFINED_AVATARS.map((av, i) => (
                          <img 
                            key={i} 
                            src={av} 
                            onClick={() => setEditAvatar(av)}
                            className={`w-10 h-10 rounded-lg cursor-pointer border-2 transition-all ${editAvatar === av ? 'border-emerald-500 scale-110' : 'border-transparent opacity-50 hover:opacity-100'}`}
                          />
                        ))}
                      </div>
                      <div className="flex justify-center">
                        <button 
                          onClick={() => document.getElementById('avatar-upload')?.click()}
                          className="text-xs font-bold text-emerald-500 hover:text-emerald-400 flex items-center gap-1"
                        >
                          <Paperclip size={12} />
                          Upload Custom Avatar
                        </button>
                        <input 
                          id="avatar-upload"
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleAvatarUpload}
                        />
                      </div>
                    </div>
                  )}
                </div>
                
                {isEditingProfile ? (
                  <div className="space-y-4 text-left">
                    <div>
                      <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Bio</label>
                      <textarea 
                        value={editBio}
                        onChange={(e) => setEditBio(e.target.value)}
                        className="w-full bg-neutral-800 border-none rounded-xl p-3 text-sm focus:ring-1 focus:ring-emerald-500/50 h-24 resize-none"
                      />
                    </div>
                    <button 
                      onClick={handleUpdateProfile}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all"
                    >
                      Save Changes
                    </button>
                  </div>
                ) : (
                  <>
                    <h3 className="text-2xl font-bold text-white mb-1">{showProfileModal.name}</h3>
                    <p className="text-neutral-500 text-sm mb-6">@{showProfileModal.id}</p>
                    <div className="bg-neutral-800/50 rounded-2xl p-6 text-left">
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">About</p>
                      <p className="text-neutral-300 text-sm leading-relaxed italic">"{showProfileModal.bio}"</p>
                    </div>
                    {showProfileModal.id !== user.id && (
                      <button 
                        onClick={() => {
                          setActiveChat(showProfileModal.id);
                          setShowProfileModal(null);
                        }}
                        className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                      >
                        <Send size={18} />
                        Message {showProfileModal.name.split(' ')[0]}
                      </button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
