import React from 'react';
import { Server, User as UserIcon, Lock, AlertTriangle, ArrowRight } from 'lucide-react';

export default function Login({ loginForm, setLoginForm, loginError, onSubmit }) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-600/20 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl"></div>
      <div className="bg-slate-800 border border-slate-700 p-10 rounded-2xl shadow-2xl w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-700 mb-4 shadow-inner">
            <Server size={32} className="text-blue-500" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-wider">
            <span className="text-orange-500">MIRERO</span> ITAM
          </h1>
          <p className="text-slate-400 text-sm mt-2 font-medium tracking-wide">IT Asset Management System</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><UserIcon size={18} className="text-slate-500" /></div>
              <input type="text" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="관리자 아이디" required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Lock size={18} className="text-slate-500" /></div>
              <input type="password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="비밀번호" required />
            </div>
          </div>
          {loginError && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm p-3 rounded-lg flex items-center font-bold">
              <AlertTriangle size={16} className="mr-2 shrink-0" />{loginError}
            </div>
          )}
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-lg shadow-lg flex items-center justify-center mt-4">
            시스템 로그인 <ArrowRight size={18} className="ml-2 opacity-70" />
          </button>
        </form>
      </div>
    </div>
  );
}
