#include <algorithm>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <unordered_map>
#include "core/mal/fz_mal_impl.h"
#include "core/runtime/fz_runtime_profiler.h"
#include <atomic>

namespace
{
std::atomic<size_t> g_mal_alive_count{0};

#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
struct MalAllocationSite
{
    std::string file;
    int line = 0;
    std::string function;
};

std::mutex g_mal_allocation_mutex;
std::unordered_map<const FZMalImpl *, MalAllocationSite> g_mal_allocation_sites;

void RegisterMalAllocation(const FZMalImpl *mal, const char *file, int line, const char *function)
{
    if (!mal)
    {
        return;
    }
    std::lock_guard<std::mutex> lock(g_mal_allocation_mutex);
    g_mal_allocation_sites[mal] = {
        file ? file : "",
        line,
        function ? function : ""
    };
}

void RegisterUnknownMalAllocation(const FZMalImpl *mal, const char *function)
{
    const auto context = FZRuntimeProfiler::CurrentExecutionContext();
    if (!context.empty())
    {
        RegisterMalAllocation(mal, context.c_str(), 0, function);
        return;
    }
    RegisterMalAllocation(mal, "<direct-constructor>", 0, function);
}

void UnregisterMalAllocation(const FZMalImpl *mal)
{
    std::lock_guard<std::mutex> lock(g_mal_allocation_mutex);
    g_mal_allocation_sites.erase(mal);
}
#endif

constexpr size_t kSerializedVectorSize = sizeof(double) * 3;

bool IsSerializedVectorType(FZMARGType type)
{
    return type == FZMARGType::FZ_MARGTYPE_POSITION || type == FZMARGType::FZ_MARGTYPE_VECTOR;
}

size_t GetSerializedPayloadSize(FZMargBaseImpl *var)
{
    return IsSerializedVectorType(var->GetType()) ? kSerializedVectorSize : var->GetSize();
}

void WriteSerializedVector(const FZVectorType &value, void *dst)
{
    const double raw[3] = { value.x, value.y, value.z };
    memcpy(dst, raw, sizeof(raw));
}

FZVectorType ReadSerializedVector(const void *src)
{
    const double *raw = static_cast<const double *>(src);
    return FZVectorType(raw[0], raw[1], raw[2]);
}
}

struct MargBaseCoordnate : public FZMargBaseData
{
    FZCoordinateType coord;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseCoordnate();
        data->coord = coord;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(FZCoordinateType);
    }
    virtual void *get()
    {
        return &coord;
    }
    virtual void set(void *_coord)
    {
        coord = *(FZCoordinateType *)(_coord);
    }
};

struct MargBaseVector : public FZMargBaseData
{
    FZVectorType vec3;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseVector();
        data->vec3 = vec3;
        return data;
    }
    virtual size_t size()
    {
        return kSerializedVectorSize;
    }
    virtual void *get()
    {
        return &vec3;
    }
    virtual void set(void *_coord)
    {
        vec3 = *(FZVectorType *)(_coord);
    }
};

struct MargBaseOrientation : public FZMargBaseData
{
    FZOrientationType ori;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseOrientation();
        data->ori = ori;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(MargBaseOrientation);
    }
    virtual void *get()
    {
        return &ori;
    }
    virtual void set(void *_coord)
    {
        ori = *(FZOrientationType *)(_coord);
    }
};

struct MargBaseTrackHandle : public FZMargBaseData
{
    FZTrackHandleType th;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseTrackHandle();
        data->th = th;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(FZTrackHandleType);
    }
    virtual void *get()
    {
        return &th;
    }
    virtual void set(void *_coord)
    {
        th = *(FZTrackHandleType *)(_coord);
    }
};

struct MargBaseTrackHandleList : public FZMargBaseData
{
    std::vector<FZTrackHandleType> track_handle_list;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseTrackHandleList();
        data->track_handle_list = track_handle_list;
        return data;
    }
    virtual size_t size()
    {
        return sizeof(FZTrackHandleType) * track_handle_list.size();
    }
    virtual void *get()
    {
        return &track_handle_list[0];
    }
    virtual void set(void *_coord)
    {
    }
};

struct MargBaseEngagementInfo : public FZMargBaseData
{
    FZEngagementInfoType info;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseEngagementInfo();
        data->info = info;
        return data;
    }

    virtual size_t size()
    {
        return sizeof(FZEngagementInfoType);
    }

    virtual void *get()
    {
        return &info;
    }

    virtual void set(void *_info)
    {
        info = *(FZEngagementInfoType *)(_info);
    }
};

struct MargBaseMal : public FZMargBaseData
{
    FZMalImpl *mal;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseMal();
        data->mal = this->mal->Clone();
        return data;
    }

    virtual size_t size()
    {
        return sizeof(FZMalImpl);
    }

    virtual void *get()
    {
        return mal;
    }

    virtual void set(void *_info)
    {
        delete mal;
        mal = ((FZMalImpl *)_info)->Clone();
    }

    virtual ~MargBaseMal()
    {
        delete mal;
    }
};

struct MargBaseRecord : public FZMargBaseData
{
    std::vector<unsigned char> buffer_;
    size_t size_;
    FZRecordIDType id_;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseRecord();
        data->size_ = size_;
        data->id_ = id_;
        data->buffer_ = buffer_;
        return data;
    }

    virtual size_t size()
    {
        return size_;
    }

    virtual void *get()
    {
        return buffer_.empty() ? nullptr : &buffer_[0];
    }

    virtual void set(void *_info)
    {
        if (_info == nullptr || size_ == 0)
        {
            buffer_.clear();
            size_ = 0;
            return;
        }
        buffer_.resize(size_);
        memcpy(&buffer_[0], _info, size_);
    }
};

struct MargBaseTaskIdList : public FZMargBaseData
{
    std::vector<FZTaskIDType> id_list;

    virtual FZMargBaseData *clone()
    {
        auto data = new MargBaseTaskIdList();
        data->id_list = id_list;
        return data;
    }

    virtual size_t size()
    {
        return id_list.size() * sizeof(FZTaskIDType);
    }

    virtual void *get()
    {
        return &id_list[0];
    }

    virtual void set(void *_info)
    {
    }
};

std::string ComposeStringForMal(const char *_name, FZMARGType _marg_type)
{
    std::string compose_string_for_mal = _name;
    switch (_marg_type)
    {
    case FZMARGType::FZ_MARGTYPE_INVALID:
        compose_string_for_mal = "";
        break;
    case FZMARGType::FZ_MARGTYPE_TRACK_HANDLE:
    case FZMARGType::FZ_MARGTYPE_ENGAGEMENT_INFO:
    case FZMARGType::FZ_MARGTYPE_BOOL:
    case FZMARGType::FZ_MARGTYPE_UNITID:
    case FZMARGType::FZ_MARGTYPE_EQUIPMENTID:
    case FZMARGType::FZ_MARGTYPE_ENTITYID:
    case FZMARGType::FZ_MARGTYPE_TRACK_ID:
    case FZMARGType::FZ_MARGTYPE_FEATUREID:
    case FZMARGType::FZ_MARGTYPE_NAME:
    case FZMARGType::FZ_MARGTYPE_INTEGER:
    case FZMARGType::FZ_MARGTYPE_COORDINATE:
    case FZMARGType::FZ_MARGTYPE_JULIAN:
    case FZMARGType::FZ_MARGTYPE_REAL:
    case FZMARGType::FZ_MARGTYPE_POSITION:
    case FZMARGType::FZ_MARGTYPE_VECTOR:
    case FZMARGType::FZ_MARGTYPE_DMGRC:
    case FZMARGType::FZ_MARGTYPE_STRING:
    case FZMARGType::FZ_MARGTYPE_ADDRESS:
    case FZMARGType::FZ_USER_DEFINED:
    case FZMARGType::FZ_MARGTYPE_TRACK_HANDLE_LIST:
    case FZMARGType::FZ_MARGTYPE_TASK_ID_LIST:
    case FZMARGType::FZ_MARGTYPE_RECORD:
    case FZMARGType::FZ_MARGTYPE_MAL:
        compose_string_for_mal = compose_string_for_mal + "_" + std::move(std::to_string(_marg_type));
        break;
    default:
        compose_string_for_mal = "";
        break;
    }
    return std::move(compose_string_for_mal);
}

struct FZMalImplPrivate
{
    FZMalImplPrivate();
    FZMalImplPrivate(const FZMalImplPrivate &_mal);
    ~FZMalImplPrivate();

    std::vector<FZMargBaseImpl *> fz_marg_impl_list_;
};

FZMalImplPrivate::FZMalImplPrivate()
{
}

FZMalImplPrivate::~FZMalImplPrivate()
{
    for (FZMargBaseImpl *base : fz_marg_impl_list_)
    {
        if (base != nullptr)
        {
            delete(base);
            base = nullptr;
        }
    }
}

FZMalImplPrivate::FZMalImplPrivate(const FZMalImplPrivate &_mal)
{
    // 优化: 预分配空间避免频繁重新分配
    size_t size = _mal.fz_marg_impl_list_.size();
    fz_marg_impl_list_.reserve(size);
    
    for (size_t i = 0; i < size; i++)
    {
        fz_marg_impl_list_.push_back(_mal.fz_marg_impl_list_.at(i)->Clone());
    }
    
    for (size_t i = 0; i != fz_marg_impl_list_.size(); ++i)
    {
        if (i + 1 != fz_marg_impl_list_.size())
        {
            fz_marg_impl_list_.at(i)->SetRPointer(fz_marg_impl_list_.at(i + 1));
        }
        else
        {
            fz_marg_impl_list_.at(i)->SetRPointer(nullptr);
        }
        if (i != 0)
        {
            fz_marg_impl_list_.at(i)->SetLPointer(fz_marg_impl_list_.at(i - 1));
        }
        else
        {
            fz_marg_impl_list_.at(i)->SetLPointer(nullptr);
        }
    }
}

FZMalImpl::FZMalImpl()
    : fz_mal_impl_private_(new FZMalImplPrivate())
{
    ++g_mal_alive_count;
    FZRuntimeProfiler::Instance().AddMalCreated();
#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
    RegisterUnknownMalAllocation(this, "FZMalImpl::FZMalImpl");
#endif
}

FZMalImpl::FZMalImpl(const FZMalImpl &_mal_impl)
    : fz_mal_impl_private_(new FZMalImplPrivate(*_mal_impl.fz_mal_impl_private_))
{
    ++g_mal_alive_count;
    FZRuntimeProfiler::Instance().AddMalCloned();
#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
    RegisterUnknownMalAllocation(this, "FZMalImpl::FZMalImpl(copy)");
#endif
}

FZMalImpl::FZMalImpl(FZMalImpl &&_mal_impl)
{
    fz_mal_impl_private_ = std::move(_mal_impl.fz_mal_impl_private_);
    _mal_impl.fz_mal_impl_private_ = nullptr;
    ++g_mal_alive_count;
    FZRuntimeProfiler::Instance().AddMalCreated();
#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
    RegisterUnknownMalAllocation(this, "FZMalImpl::FZMalImpl(move)");
#endif
}

FZMalImpl &FZMalImpl::operator=(const FZMalImpl &_mal_impl)
{
    if (&_mal_impl == this)
    {
        return *this;
    }
    if (fz_mal_impl_private_)
    {
        delete(fz_mal_impl_private_);
        fz_mal_impl_private_ = new FZMalImplPrivate(*_mal_impl.fz_mal_impl_private_);
    }
    return *this;
}

FZMalImpl::~FZMalImpl()
{
#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
    UnregisterMalAllocation(this);
#endif
    if (fz_mal_impl_private_)
    {
        delete(fz_mal_impl_private_);
        fz_mal_impl_private_ = nullptr;
    }
    --g_mal_alive_count;
    FZRuntimeProfiler::Instance().AddMalDeleted();
}

FZMalImpl *FZMalImpl::CreateMAL(){
    return new FZMalImpl();
}

FZMalImpl *FZMalImpl::CreateMALAt(const char *file, int line, const char *function)
{
    auto *mal = CreateMAL();
#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
    RegisterMalAllocation(mal, file, line, function);
#else
    (void)file;
    (void)line;
    (void)function;
#endif
    return mal;
}

FZMalImpl::Ptr FZMalImpl::CreateMALPtr()
{
    return Ptr(FOSIM_CREATE_MAL());
}

void FZMalImpl::DestroyMAL(FZMalImpl *&mal)
{
    delete mal;
    mal = nullptr;
}

size_t FZMalImpl::AliveCount()
{
    return g_mal_alive_count.load();
}

std::string FZMalImpl::BuildAliveAllocationSummary(size_t max_sites)
{
#if !defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
    (void)max_sites;
    return {};
#else
    struct SiteStats
    {
        size_t count = 0;
        MalAllocationSite site;
    };
    std::map<std::string, SiteStats> grouped;
    {
        std::lock_guard<std::mutex> lock(g_mal_allocation_mutex);
        for (const auto &entry : g_mal_allocation_sites)
        {
            const auto &site = entry.second;
            std::ostringstream key;
            key << site.file << ':' << site.line << ':' << site.function;
            auto &stats = grouped[key.str()];
            ++stats.count;
            stats.site = site;
        }
    }

    std::vector<SiteStats> sites;
    sites.reserve(grouped.size());
    for (const auto &entry : grouped)
    {
        sites.push_back(entry.second);
    }
    std::sort(sites.begin(), sites.end(), [](const SiteStats &lhs, const SiteStats &rhs) {
        return lhs.count > rhs.count;
    });

    std::ostringstream out;
    out << "MAL_ALIVE_ALLOCATIONS total=" << g_mal_allocation_sites.size();
    const size_t limit = std::min(max_sites, sites.size());
    for (size_t i = 0; i < limit; ++i)
    {
        out << " site" << i << "_count=" << sites[i].count
            << " site" << i << "_file=" << sites[i].site.file
            << " site" << i << "_line=" << sites[i].site.line
            << " site" << i << "_function=" << sites[i].site.function;
    }
    return out.str();
#endif
}

std::vector<FZMargBaseImpl *> FZMalImpl::GetMargList() const
{
    std::vector<FZMargBaseImpl *> margbase_list;
    margbase_list = fz_mal_impl_private_->fz_marg_impl_list_;
    return margbase_list;
}

void FZMalImpl::SetMargList(const std::vector<FZMargBaseImpl *> &_fz_marg_impl_list)
{
    for (auto &var : fz_mal_impl_private_->fz_marg_impl_list_)
    {
        delete(var);
        var = nullptr;
    }
    fz_mal_impl_private_->fz_marg_impl_list_.clear();

    fz_mal_impl_private_->fz_marg_impl_list_ = _fz_marg_impl_list;
    for (size_t i = 0; i != fz_mal_impl_private_->fz_marg_impl_list_.size(); ++i)
    {
        if (i + 1 != fz_mal_impl_private_->fz_marg_impl_list_.size())
        {
            fz_mal_impl_private_->fz_marg_impl_list_.at(i)->SetRPointer(fz_mal_impl_private_->fz_marg_impl_list_.at(i + 1));
        }
        else
        {
            fz_mal_impl_private_->fz_marg_impl_list_.at(i)->SetRPointer(nullptr);
        }

        if (i != 0)
        {
            fz_mal_impl_private_->fz_marg_impl_list_.at(i)->SetLPointer(fz_mal_impl_private_->fz_marg_impl_list_.at(i - 1));
        }
        else
        {
            fz_mal_impl_private_->fz_marg_impl_list_.at(i)->SetLPointer(nullptr);
        }
    }
}

FZMalImpl *FZMalImpl::Clone()
{
    return new FZMalImpl(*this);
}

FZRC FZMalImpl::AddAddress(const char *_name, void *_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMARGType marg_type = FZMARGType::FZ_MARGTYPE_ADDRESS;

    auto marg = new FZMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

FZRC FZMalImpl::AddBoolean(const char *_name, const FZBOOL &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto marg = new FZMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetBoolean(const char *_arg_name, FZBOOL &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_BOOL);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZBOOL *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddCoordinate(const char *_name, const FZCoordinateType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto coord_data = new MargBaseCoordnate();
    coord_data->coord = _value;
    auto marg = new FZMargBaseImpl(_name, coord_data, FZMARGType::FZ_MARGTYPE_COORDINATE);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetCoordinate(const char *_arg_name, FZCoordinateType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_COORDINATE);

    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZCoordinateType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddDMGRC(const char *_name, const FZDMGRC &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMARGType marg_type = FZMARGType::FZ_MARGTYPE_DMGRC;
    auto marg = new FZMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetDMGRC(const char *_arg_name, FZDMGRC &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_DMGRC);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZDMGRC *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddEngagementInfo(const char *_name, const FZEngagementInfoType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto data = new MargBaseEngagementInfo();
    data->info = _value;

    auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_ENGAGEMENT_INFO);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetEngagementInfo(const char *_arg_name, FZEngagementInfoType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_ENGAGEMENT_INFO);

    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZEngagementInfoType *)marg_base->GetValue();

    return FZRC::FZ_SUCCESS;
}

FZEngagementInfoType FZMalImpl::GetEngagementInfo(const char *_arg_name, FZRC *_res)
{
    FZEngagementInfoType res;
    if (_res)
    {
        *_res = GetEngagementInfo(_arg_name, res);
    }
    else
    {
        GetEngagementInfo(_arg_name, res);
    }
    return res;
}

FZRC FZMalImpl::AddEquipmentID(const char *_name, const FZEntityIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_EQUIPMENTID);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetEquipmentID(const char *_arg_name, FZEntityIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_EQUIPMENTID);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZEntityIDType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddEntityID(const char *_name, const FZEntityIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_ENTITYID);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetEntityID(const char *_arg_name, FZEntityIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_ENTITYID);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZEntityIDType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddInterID(const char *_name, const FZInterIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_INTERID);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetInterID(const char *_arg_name, FZInterIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_INTERID);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZInterIDType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddFeatureID(const char *_name, const FZFeatureIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_FEATUREID);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetFeatureID(const char *_arg_name, FZFeatureIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_FEATUREID);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZFeatureIDType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddInteger(const char *_name, const FZIntegerType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMARGType marg_type = FZMARGType::FZ_MARGTYPE_INTEGER;
    auto marg = new FZMargBaseImpl(_name, _value);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetInteger(const char *_arg_name, FZIntegerType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_INTEGER);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZIntegerType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddJulian(const char *_name, const FZJulianType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_JULIAN);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetJulian(const char *_arg_name, FZJulianType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_JULIAN);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZJulianType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddMal(const char *_name, FZMalImpl *_value)
{
    if (_name == nullptr || _value == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto data = new MargBaseMal();
    data->mal = _value->Clone();

    auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_MAL);
    return AddArgument(marg);
}

FZMalImpl *FZMalImpl::GetMal(const char *_arg_name)
{
    if (_arg_name == nullptr)
    {
        return nullptr;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_MAL);
    if (marg_base == nullptr)
    {
        return nullptr;
    }
    return (FZMalImpl *)marg_base->GetValue();
}

FZRC FZMalImpl::GetMal(const char *_arg_name, FZMalImpl *&_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_MAL);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = (FZMalImpl *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddRecord(const char *_name, void *_record, size_t _record_size, FZRecordIDType _record_id /*= 0*/)
{
    if (_name == nullptr || _record == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    MargBaseRecord data;
    data.id_ = _record_id;
    data.size_ = _record_size;
    data.set(_record);

    auto marg = new FZMargBaseImpl(_name, data.clone(), FZMARGType::FZ_MARGTYPE_RECORD);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetRecord(const char *_name, void *_record, size_t &_record_size, FZRecordIDType &_record_id)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_RECORD);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    const size_t stored_size = marg_base->GetSize();
    if (_record == nullptr || _record_size < stored_size)
    {
        // 调用方可先传入空缓冲或较小缓冲探测所需大小，避免历史实现直接 memcpy 造成越界写入。
        _record_size = stored_size;
        _record_id = 0;
        return FZRC::FZ_FAILURE;
    }

    memcpy(_record, marg_base->GetValue(), marg_base->GetCapacity());
    _record_size = stored_size;
    _record_id = 0;
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddTaskIdList(const char *_name, const FZTaskIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_TASK_ID_LIST);
    if (marg_base == nullptr)
    {
        auto data = new MargBaseTaskIdList();
        data->id_list.push_back(_value);
        auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_TASK_ID_LIST);
        return AddArgument(marg);
    }
    else
    {
        auto data = marg_base->GetUserDefineData();
        auto task_id_list_data = dynamic_cast<MargBaseTaskIdList *>(data);
        if (task_id_list_data)
        {
            task_id_list_data->id_list.push_back(_value);
        }
    }
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddName(const char *_name, const char *_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_NAME);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetName(const char *_arg_name, char *_name)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_NAME);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    char *name = (char *)GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_NAME)->GetValue();
    if (_name == nullptr || name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    const size_t name_length = std::strlen(name);
    std::memcpy(_name, name, name_length + 1);
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddPosition(const char *_name, const FZPositionType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto data = new MargBaseVector();
    data->vec3 = _value;
    auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_POSITION);

    return AddArgument(marg);
}

FZRC FZMalImpl::GetPosition(const char *_arg_name, FZPositionType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_POSITION);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZPositionType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddReal(const char *_name, const FZRealType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_REAL);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetReal(const char *_arg_name, FZRealType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_REAL);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZRealType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddTrackHandle(const char *_name, const FZTrackHandleType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto data = new MargBaseTrackHandle();
    data->th = _value;

    auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_TRACK_HANDLE);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetTrackHandle(const char *_arg_name, FZTrackHandleType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_TRACK_HANDLE);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZTrackHandleType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddTrackID(const char *_name, const FZTrackIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_TRACK_ID);
    return AddArgument(marg);
}

FZRC FZMalImpl::AddUnitID(const char *_name, const FZEntityIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_UNITID);

    return AddArgument(marg);
}

FZRC FZMalImpl::GetUnitID(const char *_arg_name, FZEntityIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_UNITID);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZEntityIDType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddVector(const char *_name, const FZVectorType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto data = new MargBaseVector();
    data->vec3 = _value;

    auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_VECTOR);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetOrientation(const char *_arg_name, FZOrientationType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_ORIENTATION);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZOrientationType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddOrientation(const char *_name, const FZOrientationType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    auto data = new MargBaseOrientation();
    data->ori = _value;

    auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_ORIENTATION);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetVector(const char *_arg_name, FZVectorType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_VECTOR);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZVectorType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddString(const char *_name, const char *_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    auto marg = new FZMargBaseImpl(_name, _value, FZMARGType::FZ_MARGTYPE_STRING);
    return AddArgument(marg);
}

const char *FZMalImpl::GetString(const char *_arg_name)
{
    if (_arg_name == nullptr)
    {
        return nullptr;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_STRING);
    if (marg_base == nullptr)
    {
        return nullptr;
    }
    return (char *)marg_base->GetValue();
}

FZRC FZMalImpl::GetString(const char *_arg_name, char *&_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_STRING);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = (char *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddTrackHandleList(const char *_name, const FZTrackHandleType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_TRACK_HANDLE_LIST);

    if (marg_base == nullptr)
    {
        auto data = new MargBaseTrackHandleList();
        data->track_handle_list.push_back(_value);

        auto marg = new FZMargBaseImpl(_name, data, FZMARGType::FZ_MARGTYPE_TRACK_HANDLE_LIST);
        return AddArgument(marg);
    }
    else
    {
        auto data = dynamic_cast<MargBaseTrackHandleList *>(marg_base->GetUserDefineData());
        data->track_handle_list.push_back(_value);
    }
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::GetTrackHandleList(const char *_name, size_t _index, FZTrackHandleType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_TRACK_HANDLE_LIST);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }

    size_t max_index = marg_base->GetSize() / sizeof(FZTrackHandleType) - 1;
    if (_index > max_index)
    {
        return FZ_FAILURE;
    }
    _value = *(FZTrackHandleType *)((FZTrackHandleType *)marg_base->GetValue() + _index);

    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::GetTrackHandleListSize(const char *_name, size_t &_size)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_TRACK_HANDLE_LIST);
    if (marg_base == nullptr)
    {
        _size = 0;
        return FZRC::FZ_FAILURE;
    }
    _size = marg_base->GetSize() / sizeof(FZTrackHandleType);
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddPODData(const char *_name, void *_pod_data, size_t _pod_data_size)
{
    if (_name == nullptr || _pod_data == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    MargBaseRecord data;
    data.size_ = _pod_data_size;
    data.id_ = 0;
    data.set(_pod_data);

    auto marg = new FZMargBaseImpl(_name, data.clone(), FZMARGType::FZ_USER_DEFINED);
    return AddArgument(marg);
}

FZRC FZMalImpl::GetPODData(const char *_name, void *_pod_data, size_t &_pod_data_size)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_name, FZMARGType::FZ_USER_DEFINED);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    memcpy(_pod_data, marg_base->GetValue(), marg_base->GetCapacity());
    _pod_data_size = marg_base->GetSize();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AppendMal(FZMalImpl *_mal_value)
{
    if (nullptr == _mal_value)
    {
        return FZRC::FZ_FAILURE;
    }

    auto &input_list = _mal_value->fz_mal_impl_private_->fz_marg_impl_list_;
    for (FZMargBaseImpl *var : input_list)
    {
        FZMargBaseImpl *new_marg = var->Clone();
        AddArgument(new_marg);
    }

    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::MalDestroy()
{
    // 兼容旧调用入口：历史实现会在这里 delete this，调用方稍有复用就会产生悬空指针。
    // 新版只清空内容，真正对象生命周期交给创建方或智能指针管理。
    return DropArgumentList();
}

FZRC FZMalImpl::ResetForReuse()
{
    FZRuntimeProfiler::Instance().AddMalReset();
    return DropArgumentList();
}

FZRC FZMalImpl::DropArgument(FZMargBaseImpl *_marg_value)
{
    for (auto iter = fz_mal_impl_private_->fz_marg_impl_list_.begin();
         iter != fz_mal_impl_private_->fz_marg_impl_list_.end();)
    {
        if (*iter == _marg_value)
        {
            iter = fz_mal_impl_private_->fz_marg_impl_list_.erase(iter);
            delete(_marg_value);
            return FZRC::FZ_SUCCESS;
        }
        else
        {
            iter++;
        }
    }
    return FZRC::FZ_FAILURE;
}

FZRC FZMalImpl::DropArgumentByName(const char *_name, FZMARGType _marg_type)
{
    FZRC rt = FZRC::FZ_FAILURE;
    for (auto jtor = fz_mal_impl_private_->fz_marg_impl_list_.begin();
         jtor != fz_mal_impl_private_->fz_marg_impl_list_.end(); ++jtor)
    {
        if (strcmp(_name, (*jtor)->GetName()) == 0 && _marg_type == (*jtor)->GetType())
        {

            //删除
        if (jtor != fz_mal_impl_private_->fz_marg_impl_list_.begin() && (jtor + 1) != fz_mal_impl_private_->fz_marg_impl_list_.end())
            {
                (*(jtor - 1))->SetRPointer(*(jtor + 1));
                (*(jtor + 1))->SetLPointer(*(jtor - 1));
            }
        else if (jtor == fz_mal_impl_private_->fz_marg_impl_list_.begin())
            {
                (*(jtor + 1))->SetLPointer(nullptr);
            }
        else if ((jtor + 1) == fz_mal_impl_private_->fz_marg_impl_list_.end())
            {
                (*(jtor - 1))->SetRPointer(nullptr);
            }
            else
            {
                //出错；
            }

            fz_mal_impl_private_->fz_marg_impl_list_.erase(jtor);
            rt = FZRC::FZ_SUCCESS;
            break;
        }
    }
    return rt;
}

FZRC FZMalImpl::DropArgumentList()
{
    if (fz_mal_impl_private_->fz_marg_impl_list_.empty())
    {
        return FZRC::FZ_FAILURE;
    }

    for (auto &var : fz_mal_impl_private_->fz_marg_impl_list_)
    {
        delete(var);
        var = nullptr;
    }

    fz_mal_impl_private_->fz_marg_impl_list_.clear();
    return FZRC::FZ_SUCCESS;
}

FZMargBaseImpl *FZMalImpl::GetArgumentByName(const char *_arg_name, FZMARGType _arg_type)
{
    for (auto &var : fz_mal_impl_private_->fz_marg_impl_list_)
    {
        if (strcmp(_arg_name, var->GetName()) == 0 && _arg_type == var->GetType())
        {
            return var;
        }
    }
    return nullptr;
}

FZMargBaseImpl *FZMalImpl::GetFirstArgument()
{
    if (fz_mal_impl_private_->fz_marg_impl_list_.empty())
    {
        return nullptr;
    }
    return *fz_mal_impl_private_->fz_marg_impl_list_.begin();
}

FZMargBaseImpl *FZMalImpl::GetLastArgument()
{
    return fz_mal_impl_private_->fz_marg_impl_list_.back();
}

FZMargBaseImpl *FZMalImpl::GetNextArgument(FZMargBaseImpl *_current_arg)
{
    return _current_arg->GetNextPointer();
}

FZMargBaseImpl *FZMalImpl::GetPreviousArgument(FZMargBaseImpl *_current_arg)
{
    return _current_arg->GetPreviousPointer();
}

FZRC FZMalImpl::SerializeMal(void **_ptr, size_t &_size, size_t _pre_malloc_size)
{
    size_t seralize_size = this->GetSerializeSize();

    if (seralize_size == 0)
    {
        return FZRC::FZ_FAILURE;
    }

    *_ptr = malloc(seralize_size);
    _size = Serialize(this, *_ptr);

    return _size > 0 ? FZRC::FZ_SUCCESS : FZRC::FZ_FAILURE;
}

FZRC FZMalImpl::DeSerializeMal(void *_ptr, size_t _real_size)
{
    if (_ptr == nullptr || _real_size == 0)
    {
        return FZRC::FZ_FAILURE;
    }
    return DeSerialize(this, _ptr, _real_size);
}

size_t FZMalImpl::GetSerializeSize()
{
    return GetSerializeSize(this);
}

size_t FZMalImpl::GetSerializeSize(FZMalImpl *_mal)
{
    // 序列化流开头保存成员数量，历史实现漏算该字段会导致 SerializeMal 分配不足。
    size_t total_size = sizeof(size_t);
    for (auto var : _mal->fz_mal_impl_private_->fz_marg_impl_list_)
    {
        total_size += sizeof(size_t);
        total_size += sizeof(FZMARGType);
        total_size += sizeof(size_t);
        total_size += strlen(var->GetName());

        if (var->GetType() == FZMARGType::FZ_MARGTYPE_MAL)
        {
            total_size += GetSerializeSize((FZMalImpl *)var->GetValue());
        }
        else
        {
            total_size += GetSerializedPayloadSize(var);
        }
    }
    return total_size;
}

size_t FZMalImpl::Serialize(const FZMalImpl *_mal, void *_ptr)
{
    if (_ptr == nullptr)
    {
        return 0;
    }

    size_t serialize_size = GetSerializeSize(const_cast<FZMalImpl *>(_mal));
    char *data = (char *)(_ptr);
    size_t index = 0;

    size_t *member_count = (size_t *)&data[index];
    index += sizeof(size_t);
    *member_count = _mal->fz_mal_impl_private_->fz_marg_impl_list_.size();

    for (auto var : _mal->fz_mal_impl_private_->fz_marg_impl_list_)
    {
        size_t *name_len = (size_t *)&data[index];
        index += sizeof(size_t);

        FZMARGType *marg_type = (FZMARGType *)&data[index];
        index += sizeof(FZMARGType);

        size_t *data_len = (size_t *)&data[index];
        index += sizeof(size_t);

        *marg_type = var->GetType();
        *name_len = strlen(var->GetName());
        memcpy(&data[index], var->GetName(), *name_len);
        index += *name_len;
        if (var->GetType() == FZMARGType::FZ_MARGTYPE_MAL)
        {
            *data_len = GetSerializeSize((FZMalImpl *)var->GetValue());
            Serialize((FZMalImpl *)var->GetValue(), &data[index]);
        }
        else if (IsSerializedVectorType(var->GetType()))
        {
            *data_len = kSerializedVectorSize;
            WriteSerializedVector(*static_cast<FZVectorType *>(var->GetValue()), &data[index]);
        }
        else if (var->GetType() == FZMARGType::FZ_MARGTYPE_ADDRESS)
        {
            *data_len = sizeof(void *);
            void *pointer_value = var->GetValue();
            memcpy(&data[index], &pointer_value, *data_len);
        }
        else
        {
            *data_len = var->GetSize();
            memcpy(&data[index], var->GetValue(), *data_len);
        }
        index += *data_len;
    }
    return serialize_size;
}

FZRC FZMalImpl::DeSerialize(FZMalImpl *_mal, const void *_ptr, size_t _real_size)
{
    if (_mal == nullptr || _ptr == nullptr || _real_size < sizeof(size_t))
    {
        return FZRC::FZ_FAILURE;
    }

    const char *data = static_cast<const char *>(_ptr);
    size_t index = 0;
    auto remaining = [&]() -> size_t {
        return index <= _real_size ? _real_size - index : 0;
    };
    auto readBytes = [&](void *dst, size_t len) -> bool {
        if (len > remaining())
        {
            return false;
        }
        if (len > 0)
        {
            memcpy(dst, data + index, len);
        }
        index += len;
        return true;
    };

    size_t member_count = 0;
    if (!readBytes(&member_count, sizeof(member_count)))
    {
        return FZRC::FZ_FAILURE;
    }

    // 反序列化先写入临时 MAL。全部字段校验成功后再替换目标，避免半包数据污染旧内容。
    FZMalImpl temp;
    for (size_t i = 0; i < member_count; ++i)
    {
        size_t name_len = 0;
        FZMARGType data_type = FZMARGType::FZ_MARGTYPE_INVALID;
        size_t data_len = 0;
        if (!readBytes(&name_len, sizeof(name_len)) ||
            !readBytes(&data_type, sizeof(data_type)) ||
            !readBytes(&data_len, sizeof(data_len)) ||
            name_len > remaining())
        {
            return FZRC::FZ_FAILURE;
        }

        std::string marg_name;
        marg_name.resize(name_len);
        if (!readBytes(name_len == 0 ? nullptr : &marg_name[0], name_len) ||
            data_len > remaining())
        {
            return FZRC::FZ_FAILURE;
        }

        const char *data_ptr = data + index;
        index += data_len;
        std::unique_ptr<FZMargBaseImpl> new_marg;

        // 下面每个分支都先校验字段长度，再读取具体类型，避免越界读取和历史固定缓冲截断。
        if (data_type == FZMARGType::FZ_MARGTYPE_MAL)
        {
            auto new_mal = FZMalImpl::CreateMALPtr();
            if (data_len > 0 && DeSerialize(new_mal.get(), data_ptr, data_len) != FZRC::FZ_SUCCESS)
            {
                return FZRC::FZ_FAILURE;
            }
            auto mal_data = new MargBaseMal();
            mal_data->mal = new_mal.release();
            new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), mal_data, data_type));
        }
        else
        {
            switch (data_type)
            {
            case FZMARGType::FZ_MARGTYPE_ADDRESS:
                if (data_len != sizeof(void *)) return FZRC::FZ_FAILURE;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), *(void **)data_ptr));
                break;
            case FZMARGType::FZ_MARGTYPE_BOOL:
                if (data_len != sizeof(FZBOOL)) return FZRC::FZ_FAILURE;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), *(FZBOOL *)data_ptr));
                break;
            case FZMARGType::FZ_MARGTYPE_COORDINATE:
            {
                if (data_len != sizeof(FZCoordinateType)) return FZRC::FZ_FAILURE;
                auto marg_base_data = new MargBaseCoordnate();
                marg_base_data->coord = *(FZCoordinateType *)data_ptr;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_DMGRC:
                if (data_len != sizeof(FZDMGRC)) return FZRC::FZ_FAILURE;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), *(FZDMGRC *)data_ptr));
                break;
            case FZMARGType::FZ_MARGTYPE_ENGAGEMENT_INFO:
            {
                if (data_len != sizeof(FZEngagementInfoType)) return FZRC::FZ_FAILURE;
                auto marg_base_data = new MargBaseEngagementInfo();
                marg_base_data->info = *(FZEngagementInfoType *)data_ptr;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_ENTITYID:
            case FZMARGType::FZ_MARGTYPE_EQUIPMENTID:
            case FZMARGType::FZ_MARGTYPE_FEATUREID:
            case FZMARGType::FZ_MARGTYPE_INTERID:
            case FZMARGType::FZ_MARGTYPE_TRACK_ID:
            case FZMARGType::FZ_MARGTYPE_UNITID:
                if (data_len != sizeof(FZEntityIDType)) return FZRC::FZ_FAILURE;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), *(FZEntityIDType *)data_ptr, data_type));
                break;
            case FZMARGType::FZ_MARGTYPE_INTEGER:
                if (data_len != sizeof(FZIntegerType)) return FZRC::FZ_FAILURE;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), *(FZIntegerType *)data_ptr));
                break;
            case FZMARGType::FZ_MARGTYPE_JULIAN:
            case FZMARGType::FZ_MARGTYPE_REAL:
                if (data_len != sizeof(FZRealType)) return FZRC::FZ_FAILURE;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), *(FZRealType *)data_ptr, data_type));
                break;
            case FZMARGType::FZ_MARGTYPE_NAME:
            case FZMARGType::FZ_MARGTYPE_STRING:
            {
                std::string value(data_ptr, data_len);
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), value.c_str(), data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_ORIENTATION:
            {
                if (data_len != sizeof(FZOrientationType)) return FZRC::FZ_FAILURE;
                auto marg_base_data = new MargBaseOrientation();
                marg_base_data->ori = *(FZOrientationType *)data_ptr;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_POSITION:
            case FZMARGType::FZ_MARGTYPE_VECTOR:
            {
                if (data_len != kSerializedVectorSize) return FZRC::FZ_FAILURE;
                auto marg_base_data = new MargBaseVector();
                marg_base_data->vec3 = ReadSerializedVector(data_ptr);
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_RECORD:
            case FZMARGType::FZ_USER_DEFINED:
            {
                MargBaseRecord record;
                record.size_ = data_len;
                record.id_ = 0;
                record.set(const_cast<char *>(data_ptr));
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), record.clone(), data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_TASK_ID_LIST:
            {
                if (data_len % sizeof(FZTaskIDType) != 0) return FZRC::FZ_FAILURE;
                size_t count = data_len / sizeof(FZTaskIDType);
                auto marg_base_data = new MargBaseTaskIdList();
                marg_base_data->id_list.resize(count);
                if (data_len > 0) memcpy(&marg_base_data->id_list[0], data_ptr, data_len);
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_TRACK_HANDLE:
            {
                if (data_len != sizeof(FZTrackHandleType)) return FZRC::FZ_FAILURE;
                auto marg_base_data = new MargBaseTrackHandle();
                marg_base_data->th = *(FZTrackHandleType *)data_ptr;
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            case FZMARGType::FZ_MARGTYPE_TRACK_HANDLE_LIST:
            {
                if (data_len % sizeof(FZTrackHandleType) != 0) return FZRC::FZ_FAILURE;
                size_t count = data_len / sizeof(FZTrackHandleType);
                auto marg_base_data = new MargBaseTrackHandleList();
                marg_base_data->track_handle_list.resize(count);
                if (data_len > 0) memcpy(&marg_base_data->track_handle_list[0], data_ptr, data_len);
                new_marg.reset(new FZMargBaseImpl(marg_name.c_str(), marg_base_data, data_type));
                break;
            }
            default:
                return FZRC::FZ_FAILURE;
            }
        }

        if (!new_marg || temp.AddArgument(new_marg.get()) != FZRC::FZ_SUCCESS)
        {
            return FZRC::FZ_FAILURE;
        }
        new_marg.release();
    }

    if (index != _real_size)
    {
        return FZRC::FZ_FAILURE;
    }

    *_mal = temp;
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::AddArgument(FZMargBaseImpl *_margs)
{
    if (nullptr == _margs)
    {
        return FZRC::FZ_FAILURE;
    }

    if (fz_mal_impl_private_->fz_marg_impl_list_.empty())
    {
        fz_mal_impl_private_->fz_marg_impl_list_.emplace_back(_margs);
    }
    else
    {
        fz_mal_impl_private_->fz_marg_impl_list_.back()->SetRPointer(_margs);
        _margs->SetLPointer(fz_mal_impl_private_->fz_marg_impl_list_.back());
        fz_mal_impl_private_->fz_marg_impl_list_.emplace_back(_margs);
    }
    return FZRC::FZ_SUCCESS;
}

void *FZMalImpl::GetAddress(const char *_name)
{
    if (_name == nullptr)
    {
        return nullptr;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_ADDRESS);
    if (marg_base == nullptr)
    {
        return nullptr;
    }
    return marg_base->GetValue();
}

FZRC FZMalImpl::GetAddress(const char *_name, void *&_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_ADDRESS);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::GetTrackID(const char *_arg_name, FZTrackIDType &_value)
{
    if (_arg_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_TRACK_ID);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    _value = *(FZTrackIDType *)marg_base->GetValue();
    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::GetTaskIdList(const char *_name, size_t _index, FZTaskIDType &_value)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_TASK_ID_LIST);
    if (marg_base == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    //找到；
    size_t max_index = marg_base->GetSize() / sizeof(FZTaskIDType) - 1;
    if (_index > max_index)
    {
        return FZ_FAILURE;
    }
    _value = *(FZTaskIDType *)((FZTaskIDType *)marg_base->GetValue() + _index);

    return FZRC::FZ_SUCCESS;
}

FZRC FZMalImpl::GetTaskIdListSize(const char *_name, size_t &_size)
{
    if (_name == nullptr)
    {
        return FZRC::FZ_FAILURE;
    }
    FZMargBaseImpl *marg_base = (FZMargBaseImpl *)GetArgumentByName(_name, FZMARGType::FZ_MARGTYPE_TASK_ID_LIST);
    if (marg_base == nullptr)
    {
        _size = 0;
        return FZRC::FZ_FAILURE;
    }
    _size = marg_base->GetSize() / sizeof(FZTaskIDType);
    return FZRC::FZ_SUCCESS;
}

FZBOOL FZMalImpl::GetBoolean(const char *_arg_name, FZRC *_res)
{
    FZBOOL res;
    if (_res)
    {
        *_res = GetBoolean(_arg_name, res);
    }
    else
    {
        GetBoolean(_arg_name, res);
    }
    return res;
}

FZCoordinateType FZMalImpl::GetCoordinate(const char *_arg_name, FZRC *_res)
{
    FZCoordinateType res;
    if (_res)
    {
        *_res = GetCoordinate(_arg_name, res);
    }
    else
    {
        GetCoordinate(_arg_name, res);
    }
    return res;
}

FZDMGRC FZMalImpl::GetDMGRC(const char *_arg_name, FZRC *_res)
{
    FZDMGRC res = FZ_DMGRC_UNKNOWN;
    if (_res)
    {
        *_res = GetDMGRC(_arg_name, res);
    }
    else
    {
        GetDMGRC(_arg_name, res);
    }
    return res;
}

FZEntityIDType FZMalImpl::GetEquipmentID(const char *_arg_name, FZRC *_res)
{
    FZEntityIDType res = 0;
    if (_res)
    {
        *_res = GetEquipmentID(_arg_name, res);
    }
    else
    {
        GetEquipmentID(_arg_name, res);
    }
    return res;
}

FZEntityIDType FZMalImpl::GetEntityID(const char *_arg_name, FZRC *_res)
{
    FZEntityIDType res = 0;
    if (_res)
    {
        *_res = GetEntityID(_arg_name, res);
    }
    else
    {
        GetEntityID(_arg_name, res);
    }
    return res;
}

FZInterIDType FZMalImpl::GetInterID(const char *_arg_name, FZRC *_res)
{
    FZInterIDType res = 0;
    if (_res)
    {
        *_res = GetInterID(_arg_name, res);
    }
    else
    {
        GetInterID(_arg_name, res);
    }
    return res;
}

FZFeatureIDType FZMalImpl::GetFeatureID(const char *_arg_name, FZRC *_res)
{
    FZFeatureIDType res = 0;
    if (_res)
    {
        *_res = GetFeatureID(_arg_name, res);
    }
    else
    {
        GetFeatureID(_arg_name, res);
    }
    return res;
}

FZIntegerType FZMalImpl::GetInteger(const char *_arg_name, FZRC *_res)
{
    FZIntegerType res = 0;
    if (_res)
    {
        *_res = GetInteger(_arg_name, res);
    }
    else
    {
        GetInteger(_arg_name, res);
    }
    return res;
}

FZJulianType FZMalImpl::GetJulian(const char *_arg_name, FZRC *_res)
{
    FZJulianType res = 0;
    if (_res)
    {
        *_res = GetJulian(_arg_name, res);
    }
    else
    {
        GetJulian(_arg_name, res);
    }
    return res;
}

FZTrackIDType FZMalImpl::GetTrackID(const char *_name, FZRC *_res)
{
    FZTrackIDType res = 0;
    if (_res)
    {
        *_res = GetTrackID(_name, res);
    }
    else
    {
        GetTrackID(_name, res);
    }
    return res;
}

FZEntityIDType FZMalImpl::GetUnitID(const char *_name, FZRC *_res)
{
    FZEntityIDType res = 0;
    if (_res)
    {
        *_res = GetUnitID(_name, res);
    }
    else
    {
        GetUnitID(_name, res);
    }
    return res;
}

FZOrientationType FZMalImpl::GetOrientation(const char *_arg_name, FZRC *_res)
{
    FZOrientationType res;
    if (_res)
    {
        *_res = GetOrientation(_arg_name, res);
    }
    else
    {
        GetOrientation(_arg_name, res);
    }
    return res;
}

FZVectorType FZMalImpl::GetVector(const char *_arg_name, FZRC *_res)
{
    FZVectorType res;
    if (_res)
    {
        *_res = GetVector(_arg_name, res);
    }
    else
    {
        GetVector(_arg_name, res);
    }
    return res;
}

FZRealType FZMalImpl::GetReal(const char *_arg_name, FZRC *_res)
{
    FZRealType res = 0;
    if (_res)
    {
        *_res = GetReal(_arg_name, res);
    }
    else
    {
        GetReal(_arg_name, res);
    }
    return res;
}

const char *FZMalImpl::GetName(const char *_arg_name)
{
    if (_arg_name == nullptr)
    {
        return nullptr;
    }
    auto marg = GetArgumentByName(_arg_name, FZMARGType::FZ_MARGTYPE_NAME);
    if (marg == nullptr)
    {
        return nullptr;
    }
    return (const char *)marg->GetValue();
}

FZPositionType FZMalImpl::GetPosition(const char *_arg_name, FZRC *_res)
{
    FZPositionType res;
    if (_res)
    {
        *_res = GetPosition(_arg_name, res);
    }
    else
    {
        GetPosition(_arg_name, res);
    }
    return res;
}
