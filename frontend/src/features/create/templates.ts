import type {CreationMode} from "../../types";

export interface InspirationTemplate {
  id: string;
  title: string;
  subtitle: string;
  mode: CreationMode;
  duration: string;
  prompt: string;
}

export const inspirationTemplates: InspirationTemplate[] = [
  {
    id: "rain-podcast",
    title: "雨夜双人播客",
    subtitle: "两位主播在雨夜中展开一场关于生活的对话",
    mode: "podcast",
    duration: "00:58",
    prompt:
      "【角色：主播1（成年男性，嗓音低沉，略带沙哑，播客腔）】\n" +
      "【角色：主播2（年轻女性，声音温暖自然）】\n\n" +
      "【音效：窗外细雨持续落在玻璃上，室内安静温暖】\n" +
      "【对白：主播1】欢迎收听《深夜电台》。今晚，我们聊聊那些在雨中依然闪光的普通人。\n" +
      "【对白：主播2】是的。有时候，雨声反而让人更靠近真实的自己。\n" +
      "【音乐：克制、轻柔的爵士钢琴，始终低于人声】"
  },
  {
    id: "tech-ad",
    title: "科技产品广告",
    subtitle: "突出产品亮点，节奏紧凑，适合品牌宣传",
    mode: "advertisement",
    duration: "00:30",
    prompt:
      "【角色：广告播音员（三十岁男性，清亮冷静，富有科技感）】\n" +
      "【音乐：未来感合成器琶音与克制电子鼓组】\n" +
      "【对白：广告播音员】未来，此刻就在你手中。\n" +
      "【音效：清脆解锁提示音、界面滑动声、快门声】\n" +
      "【对白：广告播音员】看见更远的未来。"
  },
  {
    id: "rooftop-story",
    title: "天台夜话",
    subtitle: "一个人的深夜独白，关于成长与选择",
    mode: "audiobook",
    duration: "01:12",
    prompt:
      "【角色：旁白（30岁女性，沉静、有故事感，语速舒缓）】\n" +
      "【角色：阿哲（28岁男性，低沉疲惫但真诚）】\n" +
      "【角色：大刘（28岁男性，爽朗乐观）】\n" +
      "【音效：远处城市低鸣、晚风、易拉罐轻碰】\n" +
      "【对白：阿哲】你说，我们是不是把日子过成了当年最讨厌的样子？\n" +
      "【对白：大刘】管它呢。至少今晚，咱俩还是当年那两个小子。"
  }
];
