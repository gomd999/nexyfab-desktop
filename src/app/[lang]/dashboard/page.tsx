'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  FolderGit2, 
  Plus, 
  MoreVertical, 
  Clock, 
  Search,
  Settings,
  Users,
  CreditCard,
  LayoutGrid,
  List
} from 'lucide-react';


interface Project {
  id: string;
  name: string;
  thumbnail?: string;
  updatedAt: number;
  partCount: number;
  status: 'draft' | 'quoted' | 'ordered';
}

// Mock initial data
const MOCK_PROJECTS: Project[] = [
  { id: '1', name: 'EV Battery Housing', updatedAt: Date.now() - 3600000 * 2, partCount: 12, status: 'draft' },
  { id: '2', name: 'Drone Motor Mount', updatedAt: Date.now() - 86400000 * 1, partCount: 3, status: 'quoted' },
  { id: '3', name: 'Injection Mold Core', updatedAt: Date.now() - 86400000 * 3, partCount: 8, status: 'ordered' },
];

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams();
  const lang = (params?.lang as string) || 'ko';
  
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');

  // Load from local storage to simulate cloud projects
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nexyfab_projects');
      if (saved) {
        setProjects(JSON.parse(saved));
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const t = lang === 'ko' ? {
    title: '프로젝트 대시보드',
    newProject: '새 프로젝트',
    search: '프로젝트 검색...',
    draft: '초안',
    quoted: '견적 완료',
    ordered: '주문됨',
    parts: '개 부품',
    empty: '아직 생성된 프로젝트가 없습니다.',
    menu: {
      projects: '내 프로젝트',
      team: '팀 멤버',
      billing: '결제 관리',
      settings: '설정'
    }
  } : {
    title: 'Project Dashboard',
    newProject: 'New Project',
    search: 'Search projects...',
    draft: 'Draft',
    quoted: 'Quoted',
    ordered: 'Ordered',
    parts: 'parts',
    empty: 'No projects created yet.',
    menu: {
      projects: 'My Projects',
      team: 'Team Members',
      billing: 'Billing',
      settings: 'Settings'
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] font-sans flex flex-col">
      
      <div className="flex flex-1 pt-16">
        {/* Sidebar */}
        <div className="w-64 border-r border-[#30363d] bg-[#161b22] p-4 flex flex-col gap-2">
          <button className="flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-md bg-[#388bfd] bg-opacity-20 text-[#58a6ff] font-medium border border-[#388bfd] border-opacity-30">
            <FolderGit2 size={18} />
            {t.menu.projects}
          </button>
          <button className="flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-md hover:bg-[#30363d] text-[#8b949e] font-medium transition-colors">
            <Users size={18} />
            {t.menu.team}
          </button>
          <button className="flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-md hover:bg-[#30363d] text-[#8b949e] font-medium transition-colors">
            <CreditCard size={18} />
            {t.menu.billing}
          </button>
          <button className="flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-md hover:bg-[#30363d] text-[#8b949e] font-medium transition-colors mt-auto">
            <Settings size={18} />
            {t.menu.settings}
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            
            {/* Header Area */}
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl font-bold text-white">{t.title}</h1>
              <button 
                onClick={() => router.push(`/${lang}/shape-generator`)}
                className="flex items-center gap-2 bg-[#238636] hover:bg-[#2ea043] text-white px-4 py-2 rounded-md font-semibold transition-colors"
              >
                <Plus size={18} />
                {t.newProject}
              </button>
            </div>

            {/* Controls Area */}
            <div className="flex items-center justify-between mb-6 gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b949e]" size={16} />
                <input 
                  type="text" 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.search}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-md py-2 pl-9 pr-4 text-sm focus:border-[#58a6ff] focus:outline-none transition-colors"
                />
              </div>
              <div className="flex items-center gap-2 bg-[#161b22] border border-[#30363d] rounded-md p-1">
                <button 
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-sm ${viewMode === 'grid' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-white'}`}
                >
                  <LayoutGrid size={16} />
                </button>
                <button 
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-sm ${viewMode === 'list' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-white'}`}
                >
                  <List size={16} />
                </button>
              </div>
            </div>

            {/* Projects Grid */}
            {filteredProjects.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-[#30363d] rounded-lg">
                <FolderGit2 className="mx-auto mb-4 text-[#484f58]" size={48} />
                <p className="text-[#8b949e]">{t.empty}</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredProjects.map(project => (
                  <div 
                    key={project.id} 
                    onClick={() => router.push(`/${lang}/shape-generator?id=${project.id}`)}
                    className="group bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden hover:border-[#58a6ff] cursor-pointer transition-colors"
                  >
                    <div className="h-40 bg-[#0d1117] relative flex items-center justify-center border-b border-[#30363d]">
                      {project.thumbnail ? (
                        <img src={project.thumbnail} alt={project.name} className="w-full h-full object-cover" />
                      ) : (
                        <FolderGit2 className="text-[#30363d]" size={48} />
                      )}
                      <div className="absolute top-2 right-2 flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase
                          ${project.status === 'draft' ? 'bg-[#30363d] text-[#8b949e]' : ''}
                          ${project.status === 'quoted' ? 'bg-[#e3b341] bg-opacity-20 text-[#e3b341]' : ''}
                          ${project.status === 'ordered' ? 'bg-[#238636] bg-opacity-20 text-[#3fb950]' : ''}
                        `}>
                          {t[project.status]}
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <h3 className="font-semibold text-white truncate pr-4">{project.name}</h3>
                        <button className="text-[#8b949e] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreVertical size={16} />
                        </button>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs text-[#8b949e]">
                        <span className="flex items-center gap-1">
                          <LayoutGrid size={12} />
                          {project.partCount} {t.parts}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(project.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[#0d1117] text-[#8b949e] uppercase border-b border-[#30363d]">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Name</th>
                      <th className="px-6 py-4 font-semibold">Status</th>
                      <th className="px-6 py-4 font-semibold">Parts</th>
                      <th className="px-6 py-4 font-semibold">Last Updated</th>
                      <th className="px-6 py-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.map(project => (
                      <tr 
                        key={project.id}
                        onClick={() => router.push(`/${lang}/shape-generator?id=${project.id}`)}
                        className="border-b border-[#30363d] hover:bg-[#30363d] hover:bg-opacity-30 cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-4 font-medium text-white flex items-center gap-3">
                          <FolderGit2 className="text-[#8b949e]" size={16} />
                          {project.name}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase
                            ${project.status === 'draft' ? 'bg-[#30363d] text-[#8b949e]' : ''}
                            ${project.status === 'quoted' ? 'bg-[#e3b341] bg-opacity-20 text-[#e3b341]' : ''}
                            ${project.status === 'ordered' ? 'bg-[#238636] bg-opacity-20 text-[#3fb950]' : ''}
                          `}>
                            {t[project.status]}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#8b949e]">{project.partCount}</td>
                        <td className="px-6 py-4 text-[#8b949e]">{new Date(project.updatedAt).toLocaleDateString()}</td>
                        <td className="px-6 py-4 text-right">
                          <button className="text-[#8b949e] hover:text-white p-1">
                            <MoreVertical size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
