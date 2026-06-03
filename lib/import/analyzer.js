/**
 * NCM 数据聚合分析器
 *
 * 输入：NCM 原始数据（record / playlists / likelist）
 * 输出：结构化品味摘要 { topArtists, topGenres, era, playlists, hatedGenres }
 */

// ───────────────── 歌手 → 风格映射表 ─────────────────

/** 华语歌手 → 风格 */
const CN_MAP = {
  '周杰伦': ['华语流行', 'R&B', '中国风'],
  '林俊杰': ['华语流行', 'R&B', '情歌'],
  '陈奕迅': ['华语流行', '粤语流行', '情歌'],
  '王菲': ['华语流行', 'Dream Pop', '另类'],
  '陈绮贞': ['Indie Pop', '民谣', '清新'],
  '张悬': ['Indie Pop', '民谣', '独立'],
  '蔡健雅': ['华语流行', '成人抒情', '民谣'],
  '孙燕姿': ['华语流行', '成人抒情', 'Pop Rock'],
  '五月天': ['Pop Rock', '华语摇滚', '青春'],
  '苏打绿': ['Indie Pop', '另类摇滚', '清新'],
  '李荣浩': ['华语流行', 'R&B', '唱作人'],
  '薛之谦': ['华语流行', '情歌', '成人抒情'],
  '邓紫棋': ['华语流行', 'R&B', '实力派'],
  '田馥甄': ['华语流行', '成人抒情', 'Indie Pop'],
  '梁静茹': ['华语流行', '情歌', '成人抒情'],
  '张惠妹': ['华语流行', '情歌', '实力派'],
  '陶喆': ['R&B', '华语流行', '唱作人'],
  '方大同': ['R&B', 'Soul', '唱作人'],
  '许嵩': ['华语流行', '中国风', '唱作人'],
  '朴树': ['民谣摇滚', 'Indie Pop', '唱作人'],
  '赵雷': ['民谣', '唱作人', '城市民谣'],
  '万能青年旅店': ['另类摇滚', '独立摇滚', '前卫'],
  '草东没有派对': ['独立摇滚', '另类摇滚', 'Grunge'],
  '新裤子': ['新浪潮', '电子摇滚', 'Disco'],
  '痛仰': ['摇滚', '独立摇滚', '公路摇滚'],
  '李健': ['华语流行', '民谣', '唱作人'],
  '毛不易': ['华语流行', '民谣', '唱作人'],
  '伍佰': ['摇滚', '台客摇滚', '蓝调摇滚'],
  '杨千嬅': ['粤语流行', '情歌', '成人抒情'],
  '容祖儿': ['粤语流行', '情歌', '实力派'],
};

/** 欧美歌手 → 风格 */
const WEST_MAP = {
  'Norah Jones': ['Jazz', 'Cool Jazz', 'Adult Contemporary'],
  'Madeleine Peyroux': ['Jazz', 'Vocal Jazz', 'Blues'],
  'Billie Eilish': ['Alt Pop', 'Electropop', 'Dark Pop'],
  'Taylor Swift': ['Pop', 'Country Pop', 'Synth-Pop'],
  'Lana Del Rey': ['Dream Pop', 'Baroque Pop', 'Sadcore'],
  'The Weeknd': ['R&B', 'Synth-Pop', 'Dark R&B'],
  'Dua Lipa': ['Pop', 'Nu-Disco', 'Dance-Pop'],
  'Ed Sheeran': ['Pop', 'Singer-Songwriter', 'Folk Pop'],
  'Adele': ['Soul', 'Pop', 'Adult Contemporary'],
  'Coldplay': ['Alternative Rock', 'Pop Rock', 'Britpop'],
  'Radiohead': ['Alternative Rock', 'Art Rock', 'Electronic'],
  'Arctic Monkeys': ['Indie Rock', 'Garage Rock', 'Post-Punk'],
  'Tame Impala': ['Psychedelic Rock', 'Synth-Pop', 'Neo-Psychedelia'],
  'Bon Iver': ['Indie Folk', 'Art Pop', 'Experimental'],
  'Sufjan Stevens': ['Indie Folk', 'Art Pop', 'Chamber Pop'],
  'Fleetwood Mac': ['Classic Rock', 'Soft Rock', 'Pop Rock'],
  'The Beatles': ['Classic Rock', 'Pop Rock', 'Psychedelic Rock'],
  'Queen': ['Classic Rock', 'Glam Rock', 'Hard Rock'],
  'Pink Floyd': ['Progressive Rock', 'Psychedelic Rock', 'Art Rock'],
  'Nirvana': ['Grunge', 'Alternative Rock', 'Punk'],
  'Massive Attack': ['Trip-Hop', 'Electronic', 'Downtempo'],
  'Portishead': ['Trip-Hop', 'Electronic', 'Experimental'],
  'Bonobo': ['Electronic', 'Downtempo', 'Nu Jazz'],
  'FKJ': ['Electronic', 'Nu Jazz', 'French House'],
  'Khruangbin': ['Psychedelic Rock', 'Funk', 'World Music'],
  'Daft Punk': ['Electronic', 'French House', 'Disco'],
  'Kendrick Lamar': ['Hip-Hop', 'Conscious Rap', 'Jazz Rap'],
  'Frank Ocean': ['R&B', 'Alt R&B', 'Neo-Soul'],
  'Miles Davis': ['Jazz', 'Cool Jazz', 'Modal Jazz'],
  'John Coltrane': ['Jazz', 'Free Jazz', 'Modal Jazz'],
};

/** 日本歌手 → 风格 */
const JP_MAP = {
  '坂本龙一': ['Ambient', '电子', '先锋古典'],
  '久石让': ['电影配乐', '古典', 'New Age'],
  '椎名林檎': ['J-Rock', '另类', 'Jazz Rock'],
  '宇多田光': ['J-Pop', 'R&B', '电子'],
  '米津玄师': ['J-Pop', '电子', '唱作人'],
  'Yorushika': ['J-Rock', 'Indie', '流行摇滚'],
  'Radwimps': ['J-Rock', 'Alternative', '流行摇滚'],
  'One Ok Rock': ['J-Rock', 'Alternative Rock', 'Emo'],
  '菅野洋子': ['电影配乐', '爵士', '古典'],
  'Nujabes': ['Jazz Hip-Hop', 'Instrumental Hip-Hop', 'Lo-Fi'],
  'Cornelius': ['电子', 'Shibuya-Kei', '实验'],
  'Fishmans': ['Dream Pop', 'Dub', 'Alternative'],
  '坂本慎太郎': ['Indie Pop', 'Psychedelic', 'City Pop'],
  '细野晴臣': ['电子', 'Ambient', '实验'],
  'King Gnu': ['J-Rock', 'Alternative', 'Jazz Rock'],
  'Official髭男dism': ['J-Pop', 'Piano Rock', '流行'],
  'Aimer': ['J-Pop', 'Anime Song', 'Ballad'],
  'LiSA': ['J-Rock', 'Anime Song', 'Power Pop'],
  'Zutomayo': ['J-Pop', 'Funk', '电子'],
  '藤井风': ['J-Pop', 'R&B', 'Jazz Pop'],
  'Vaundy': ['J-Pop', 'City Pop', 'Rock'],
  'Suchmos': ['J-Rock', 'Acid Jazz', 'Funk'],
};

/** 韩国歌手 → 风格 */
const KR_MAP = {
  'IU': ['K-Pop', 'Ballad', 'Indie Pop'],
  'BTS': ['K-Pop', 'Hip-Hop', 'Pop'],
  'Blackpink': ['K-Pop', 'EDM', 'Girl Crush'],
  'DEAN': ['K-R&B', 'Alt R&B', 'Electronic'],
  'Zion.T': ['K-R&B', 'Neo-Soul', 'Hip-Hop'],
  'Crush': ['K-R&B', 'Neo-Soul', 'Ballad'],
  'Colde': ['K-R&B', 'Indie', 'Lo-Fi'],
  'Rad Museum': ['K-R&B', 'Lo-Fi', 'Indie'],
  'offonoff': ['K-R&B', 'Electronic', 'Lo-Fi'],
  'Hyukoh': ['Indie Rock', 'Alternative', 'Folk'],
  'Jannabi': ['Indie Rock', 'Retro', 'Ballad'],
  '10cm': ['Indie Folk', 'Acoustic', 'Ballad'],
  'Se So Neon': ['Indie Rock', 'Psychedelic', 'Blues Rock'],
  'AKMU': ['K-Pop', 'Folk Pop', 'Indie'],
  'Epik High': ['Hip-Hop', 'Alternative Hip-Hop', 'Conscious Rap'],
  'Balming Tiger': ['Hip-Hop', 'Alternative', 'Experimental'],
  'DPR IAN': ['K-R&B', 'Alt Pop', 'Dark Pop'],
  'pH-1': ['K-Hip-Hop', 'Melodic Rap', 'R&B'],
  'Yerin Baek': ['K-R&B', 'Indie Pop', 'Jazz'],
  'Heize': ['K-R&B', 'Ballad', 'Hip-Hop'],
  'BIBI': ['K-R&B', 'Alt Pop', 'Hip-Hop'],
};

// ───────────────── 合并映射表 ─────────────────

const ALL_MAP = { ...CN_MAP, ...WEST_MAP, ...JP_MAP, ...KR_MAP };

// ───────────────── 风格 → 讨厌风格映射 ─────────────────

/** 从用户喜欢的风格推导可能讨厌的风格 */
const HATED_GENRE_INFERENCE = {
  '重金属': ['重金属', '死亡金属', '核类', 'Thrash Metal'],
  '死亡金属': ['死亡金属', '重金属', 'Grindcore'],
  '核类': ['Metalcore', 'Deathcore', 'Post-Hardcore'],
  '喊麦': ['喊麦', '土嗨', '社会摇'],
  '土嗨': ['土嗨', '喊麦', 'DJ Remix'],
  'DJ 版 remix': ['DJ Remix', '土嗨', 'Bootleg'],
  '过度商业化的 K-Pop 偶像团体': ['Commercial K-Pop', 'Idol Pop'],
  '歌词空洞的网络神曲': ['Viral Pop', 'Meme Music'],
};

// ───────────────── 分析函数 ─────────────────

/** 归一化歌手名（去空格，全小写） */
function normalizeName(name) {
  return (name || '').replace(/\s+/g, ' ').trim();
}

/**
 * 统计 TOP N 高频歌手
 * @param {Array} songs - record 中的歌曲列表 { song: { name, ar: [{name}] }, playCount }
 * @param {number} n - 取前 N 名
 * @returns {Array<{name: string, count: number, genres: string[]}>}
 */
function extractTopArtists(songs, n = 20) {
  const counter = new Map();
  for (const item of songs || []) {
    const ar = item.song?.ar || [];
    for (const artist of ar) {
      const name = normalizeName(artist.name);
      if (!name) continue;
      counter.set(name, (counter.get(name) || 0) + (item.playCount || 1));
    }
  }

  const sorted = [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

  return sorted.map(([name, count]) => ({
    name,
    count,
    genres: ALL_MAP[name] || [],
  }));
}

/**
 * 从高频歌手推导风格标签
 */
function extractTopGenres(artists) {
  const genreCounter = new Map();
  for (const a of artists) {
    for (const g of a.genres) {
      genreCounter.set(g, (genreCounter.get(g) || 0) + a.count);
    }
  }
  const sorted = [...genreCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return sorted.map(([name, count]) => ({ name, count }));
}

/**
 * 推断讨厌风格（基于用户喜欢风格的镜像 + 默认排除）
 */
function inferHatedGenres(topGenres) {
  const hated = new Set();
  // 默认讨厌列表
  const defaults = ['重金属', '死亡金属', '核类', '喊麦', '土嗨', 'DJ 版 remix', '歌词空洞的网络神曲'];
  for (const g of defaults) {
    hated.add(g);
  }
  // 如果用户喜欢的风格强烈指向某个方向，推断对应的讨厌风格
  const genreNames = new Set(topGenres.map((g) => g.name));
  for (const [liked, hatedList] of Object.entries(HATED_GENRE_INFERENCE)) {
    if (genreNames.has(liked)) {
      for (const h of hatedList) hated.add(h);
    }
  }
  return [...hated];
}

/**
 * 聚合分析：从原始 NCM 数据输出结构化品味摘要
 *
 * @param {Object} raw - { record, playlists, likelist }
 * @param {Array} raw.record.weekData - 最近一周听歌排行
 * @param {Array} raw.record.allData - 所有时间听歌排行
 * @param {Array} raw.playlists - 用户歌单列表
 * @param {Array} raw.likelist - 红心歌曲列表
 * @returns {Object} 品味摘要
 */
export function analyze(raw) {
  const { record = {}, playlists = [], likelist = [] } = raw;

  const allSongs = record.allData || [];
  const weekSongs = record.weekData || [];

  const topArtists = extractTopArtists(allSongs, 20);
  const topGenres = extractTopGenres(topArtists);
  const weekTopArtists = extractTopArtists(weekSongs, 10);
  const weekTopGenres = extractTopGenres(weekTopArtists);
  const hatedGenres = inferHatedGenres(topGenres);

  // 提取歌单信息
  const playlistSummary = (playlists || []).map((p) => ({
    name: p.name,
    id: p.id,
    trackCount: p.trackCount,
    tags: p.tags || [],
    description: p.description || '',
  }));

  // 统计时段偏好
  const eraDistribution = {};
  for (const item of allSongs) {
    const year = item.song?.publishTime
      ? new Date(item.song.publishTime).getFullYear()
      : null;
    if (!year) continue;
    const decade = `${Math.floor(year / 10) * 10}s`;
    eraDistribution[decade] = (eraDistribution[decade] || 0) + (item.playCount || 1);
  }
  const era = Object.entries(eraDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([decade, count]) => ({ decade, count }));

  return {
    topArtists,
    topGenres,
    weekTopArtists,
    weekTopGenres,
    era,
    playlists: playlistSummary,
    likedCount: likelist?.length || 0,
    totalListened: allSongs.length,
    hatedGenres,
    analyzedAt: new Date().toISOString(),
  };
}